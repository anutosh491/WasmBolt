// Wait for activation before the first-visit reload; updatefound fires earlier.
window.coi = {
  doReload: async () => {
    await navigator.serviceWorker.ready;
    window.location.reload();
  },
};
