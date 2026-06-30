export const FIREFOX_EXTENSION_ID = "localhost-control@lukaspellant.dev";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const buildFirefoxManifest = (chromeManifest) => {
  const manifest = clone(chromeManifest);
  const icons = manifest.action?.default_icon ?? manifest.icons;

  manifest.description = "Find and stop stale localhost development servers from a clean Firefox sidebar.";
  manifest.permissions = (manifest.permissions ?? []).filter((permission) => permission !== "sidePanel");
  manifest.sidebar_action = {
    default_title: manifest.action?.default_title ?? manifest.name,
    default_panel: manifest.side_panel?.default_path ?? "sidepanel.html",
    open_at_install: false,
    default_icon: icons
  };
  manifest.background = {
    scripts: [manifest.background?.service_worker ?? "background.js"]
  };
  manifest.browser_specific_settings = {
    ...(manifest.browser_specific_settings ?? {}),
    gecko: {
      ...((manifest.browser_specific_settings ?? {}).gecko ?? {}),
      id: FIREFOX_EXTENSION_ID,
      data_collection_permissions: {
        required: ["none"]
      }
    }
  };

  delete manifest.side_panel;
  delete manifest.action;
  return manifest;
};
