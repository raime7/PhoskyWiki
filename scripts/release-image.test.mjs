import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyImageReceipt } from './release.mjs';

const digest = `sha256:${'a'.repeat(64)}`, imageId = `sha256:${'b'.repeat(64)}`, sha = 'c'.repeat(40);
const receipt = { image: `ghcr.io/example/wiki@${digest}`, imageId, sha };
const Config = { Labels: { 'org.opencontainers.image.revision': sha } };
const image = { Id: digest, Descriptor: { digest }, Config };
const manifest = { schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: { digest: imageId } };
test('accepts classic config Id', () => verifyImageReceipt(receipt, { Id: imageId, Config }));
test('accepts containerd manifest Id only with the exact tested config', () => verifyImageReceipt(receipt, image, manifest));
test('accepts OCI single-platform manifest', () => verifyImageReceipt(receipt, image, { ...manifest, mediaType: 'application/vnd.oci.image.manifest.v1+json' }));
for (const [name, changedImage, changedManifest] of [
  ['wrong tested config', image, { ...manifest, config: { digest } }],
  ['wrong local manifest', { ...image, Id: `sha256:${'d'.repeat(64)}` }, manifest],
  ['wrong descriptor', { ...image, Descriptor: { digest: imageId } }, manifest],
  ['missing manifest', image, undefined],
  ['index instead of tested platform', image, { ...manifest, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [] }],
  ['wrong source label', { ...image, Config: { Labels: {} } }, manifest],
]) test(`rejects ${name}`, () => assert.throws(() => verifyImageReceipt(receipt, changedImage, changedManifest), /IMAGE_RECEIPT_MISMATCH/));
