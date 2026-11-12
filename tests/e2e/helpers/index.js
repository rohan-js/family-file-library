/**
 * helpers/index.js - Exports all domain helpers, mocks, and simulators.
 */

const cryptoHelper = require('./crypto_helper');
const { FixtureHelper, defaultFixtureHelper } = require('./fixture_helper');
const { HttpClient } = require('./http_client');
const { SupabaseMockClient, MAX_STORAGE_FILE_SIZE, ALLOWED_MIME_TYPES } = require('./supabase_mock');
const {
  KEYCODES,
  ACTIONS,
  TvDpadRouter,
  TvOverscanCalculator,
  SafeTvPdfRendererSim,
  TvDiskCacheSim,
  TtsDiagnosticSim,
  TvDesignSystemSim,
  TvFocusIndicatorSim,
  TvMultiShelfLayoutSim,
  TvCoilImageViewerSim,
  TvTextMarkdownViewerSim,
  TvZxingQrPairingSim,
  TvPinKeypadSim,
  TvHudToastSim,
} = require('./tv_state_simulator');

module.exports = {
  cryptoHelper,
  FixtureHelper,
  defaultFixtureHelper,
  HttpClient,
  SupabaseMockClient,
  MAX_STORAGE_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  KEYCODES,
  ACTIONS,
  TvDpadRouter,
  TvOverscanCalculator,
  SafeTvPdfRendererSim,
  TvDiskCacheSim,
  TtsDiagnosticSim,
  TvDesignSystemSim,
  TvFocusIndicatorSim,
  TvMultiShelfLayoutSim,
  TvCoilImageViewerSim,
  TvTextMarkdownViewerSim,
  TvZxingQrPairingSim,
  TvPinKeypadSim,
  TvHudToastSim,
};
