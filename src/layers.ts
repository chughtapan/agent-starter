/**
 * @file Composes production services and platform implementations at one edge.
 */

import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import * as NodeServices from '@effect/platform-node/NodeServices';
import * as Layer from 'effect/Layer';

import { adaptersLayer } from './adapters.js';
import { boardLayer } from './board.js';
import { configurationLayer } from './config.js';
import { mailboxLayer } from './mailbox.js';
import { migrationLayer } from './migration.js';
import { onboardingLayer } from './onboarding.js';
import { pathsLayer } from './paths.js';
import { pollerLayer } from './poller.js';
import { schedulerLayer } from './scheduler.js';
import { storageLayer } from './storage.js';
import { documentTemplatesLayer } from './templates.js';

const platformLayer = Layer.mergeAll(
  NodeServices.layer,
  NodeHttpClient.layerUndici,
);

const persistenceLayer = Layer.mergeAll(pathsLayer, storageLayer).pipe(
  Layer.provideMerge(platformLayer),
);

const configuredPersistenceLayer = Layer.mergeAll(
  configurationLayer,
  documentTemplatesLayer,
).pipe(Layer.provideMerge(persistenceLayer));

const integrationLayer = Layer.mergeAll(mailboxLayer, adaptersLayer).pipe(
  Layer.provideMerge(configuredPersistenceLayer),
);

const scheduledIntegrationLayer = schedulerLayer.pipe(
  Layer.provideMerge(integrationLayer),
);

const featureLayer = Layer.mergeAll(
  boardLayer,
  onboardingLayer,
  migrationLayer,
).pipe(Layer.provideMerge(scheduledIntegrationLayer));

/** Complete production dependency graph, provided only at the application edge. */
export const mainLayer = pollerLayer.pipe(Layer.provideMerge(featureLayer));
