const CHECK_INTERVAL = 60_000;
const ACTIVATION_TIMEOUT = 12_000;

/** Register the app shell without ever reloading a session without its consent. */
export function setupPWA({ beforeUpdate, onStatus = () => {} }) {
  const updateButtons = [...document.querySelectorAll('[data-update]')];
  const installButton = document.querySelector('#install-button');
  const installDialog = document.querySelector('#install-dialog');
  const displayMode = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  let installed = false;
  let registration = null;
  let checking = null;
  let lastCheck = 0;
  let updating = false;
  let reloadRequested = false;
  let reloaded = false;
  let activationTimer = null;
  let newerController = false;
  let wasControlled = Boolean(navigator.serviceWorker?.controller);

  function reportStatus(message, isError = false) {
    if (isError) {
      // Errors must remain reachable even when Install or About covers the
      // app's live status. Closing retains a single, accessible status region.
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    }
    onStatus(message, isError);
  }

  function refreshInstall() {
    const standalone = installed || displayMode.matches || navigator.standalone === true;
    if (installButton) installButton.hidden = standalone;
    if (standalone && installDialog?.open) installDialog.close();
  }

  refreshInstall();
  displayMode.addEventListener?.('change', refreshInstall);
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    refreshInstall();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    refreshInstall();
  });
  installDialog?.addEventListener('close', () => {
    if (!installButton?.hidden) installButton?.focus();
  });
  installButton?.addEventListener('click', async () => {
    if (!installPrompt) {
      if (installDialog && !installDialog.open) installDialog.showModal();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null; // A browser install prompt may be used only once.
    installButton.disabled = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      if (installDialog && !installDialog.open) installDialog.showModal();
    } finally {
      installButton.disabled = false;
      refreshInstall();
    }
  });

  function refreshUpdates() {
    const available = Boolean(registration?.waiting) || newerController;
    for (const button of updateButtons) {
      button.hidden = !available && !updating;
      button.disabled = updating;
      button.textContent = updating ? 'Updating…' : newerController ? 'Reload update' : 'Update now';
      button.setAttribute('aria-label', updating ? 'Updating Practice Looper' : 'Update available. Update now');
    }
  }

  function reloadOnce() {
    if (!reloadRequested || reloaded) return;
    reloaded = true;
    clearTimeout(activationTimer);
    window.location.reload();
  }

  function updateFailed(message) {
    clearTimeout(activationTimer);
    updating = false;
    reloadRequested = false;
    refreshUpdates();
    reportStatus(message, true);
  }

  async function applyUpdate() {
    if (updating || (!registration?.waiting && !newerController)) return false;
    updating = true;
    refreshUpdates();
    try {
      if (await beforeUpdate() !== true) {
        // The save callback reports the specific problem and recovery action.
        // Keep that message rather than replacing it with a generic failure.
        clearTimeout(activationTimer);
        updating = false;
        reloadRequested = false;
        refreshUpdates();
        return false;
      }
      reloadRequested = true;
      if (newerController) {
        reloadOnce();
        return true;
      }
      const worker = registration.waiting;
      if (!worker) {
        updateFailed('The update changed while saving. Try updating again.');
        return false;
      }
      activationTimer = setTimeout(() => {
        updateFailed('The update did not finish. Your setup is saved; try updating again.');
      }, ACTIVATION_TIMEOUT);
      worker.postMessage({ type: 'SKIP_WAITING' });
      return true;
    } catch {
      updateFailed('The update could not be applied. Your current session is still open; try again.');
      return false;
    }
  }

  for (const button of updateButtons) button.addEventListener('click', applyUpdate);
  refreshUpdates();

  async function checkForUpdate({ force = false, announce = false } = {}) {
    if (!registration || navigator.onLine === false) return false;
    if (checking) return checking;
    if (!force && Date.now() - lastCheck < CHECK_INTERVAL) return false;
    lastCheck = Date.now();
    checking = (async () => {
      try {
        await registration.update();
        refreshUpdates();
        if (announce && !registration.waiting && !registration.installing && !newerController) {
          reportStatus('You have the latest version.');
        }
        return true;
      } catch {
        if (announce) reportStatus('Could not check for updates. Check your connection and try again.', true);
        return false;
      } finally {
        checking = null;
      }
    })();
    return checking;
  }

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    return { checkForUpdate, applyUpdate };
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) {
      reloadOnce();
    } else if (wasControlled) {
      // Another window accepted the release. This window keeps playing until
      // its user chooses to save and reload; prior hashed assets remain cached.
      newerController = true;
      refreshUpdates();
    }
    wasControlled = true;
  });

  const watchedWorkers = new WeakSet();
  function watchInstalling(worker) {
    if (!worker || watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker);
    worker.addEventListener('statechange', () => {
      refreshUpdates();
      if (worker.state === 'redundant' && navigator.onLine !== false) {
        reportStatus('An update could not finish downloading. Your current version is still available.', true);
      }
    });
  }

  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((result) => {
    registration = result;
    registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
    watchInstalling(registration.installing);
    refreshUpdates(); // Includes an update that finished before this page opened.
    checkForUpdate();
  }).catch(() => {
    if (navigator.onLine !== false) {
      reportStatus('Offline app setup could not finish. Reload to retry; YouTube still needs a connection.', true);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('online', () => checkForUpdate());
  window.setInterval(() => {
    if (document.visibilityState === 'visible') checkForUpdate();
  }, CHECK_INTERVAL);

  return { checkForUpdate, applyUpdate };
}
