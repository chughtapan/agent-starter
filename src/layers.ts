/**
 * @file Composes production services and platform implementations at one edge.
 */

import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import * as NodeServices from '@effect/platform-node/NodeServices';
import * as Layer from 'effect/Layer';

import { onboardingLayer } from './application/commissioning/index.js';
import { migrationLayer } from './application/migration/index.js';
import { pollerLayer } from './application/polling/index.js';
import { mailboxLayer } from './collaboration/mail/index.js';
import {
  boardLayer,
  receiptsLayer,
} from './collaboration/presentation/index.js';
import { adaptersLayer, schedulerLayer } from './hosts/index.js';
import { configurationLayer } from './platform/configuration/index.js';
import { documentTemplatesLayer } from './platform/documents/index.js';
import { pathsLayer, storageLayer } from './platform/persistence/index.js';
import { releasePackagesLayer, upgradesLayer } from './upgrades/index.js';

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
).pipe(
  Layer.provideMerge(
    receiptsLayer.pipe(Layer.provideMerge(scheduledIntegrationLayer)),
  ),
);

const upgradedFeatures = upgradesLayer.pipe(
  Layer.provideMerge(
    releasePackagesLayer.pipe(Layer.provideMerge(featureLayer)),
  ),
);
/** Complete production dependency graph, provided only at the application edge. */
export const mainLayer = pollerLayer.pipe(Layer.provideMerge(upgradedFeatures));
