/**
 * context.js - Context builder for test execution.
 */

const assert = require('./assert');
const helpers = require('../helpers');

function createContext(testDef, signal, config = {}) {
  // Use mock client or live client depending on config
  let client;
  if (config.live && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    client = new helpers.HttpClient(process.env.SUPABASE_URL, {
      apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    });
  } else {
    client = new helpers.SupabaseMockClient();
  }

  return {
    signal,
    client,
    storage: client.storageClient ? client.storageClient : null,
    fixtures: helpers.defaultFixtureHelper,
    tvState: {
      createDpadRouter: () => new helpers.TvDpadRouter(),
      createOverscanCalculator: () => new helpers.TvOverscanCalculator(),
      createPdfRenderer: (windowSize) => new helpers.SafeTvPdfRendererSim(windowSize),
      createDiskCache: (capacity) => new helpers.TvDiskCacheSim(capacity),
      createTtsDiagnostic: (engines) => new helpers.TtsDiagnosticSim(engines),
      createDesignSystem: (w, h) => new helpers.TvDesignSystemSim(w, h),
      createFocusIndicator: () => new helpers.TvFocusIndicatorSim(),
      createShelfLayout: () => new helpers.TvMultiShelfLayoutSim(),
      createCoilImageViewer: (ram) => new helpers.TvCoilImageViewerSim(ram),
      createTextMarkdownViewer: () => new helpers.TvTextMarkdownViewerSim(),
      createZxingQrPairing: (code) => new helpers.TvZxingQrPairingSim(code),
      createPinKeypad: (salt) => new helpers.TvPinKeypadSim(salt),
      createHudToast: () => new helpers.TvHudToastSim(),
      KEYCODES: helpers.KEYCODES,
      ACTIONS: helpers.ACTIONS,
    },
    crypto: helpers.cryptoHelper,
    assert,
    testDef,
    config,
  };
}

module.exports = {
  createContext,
};
