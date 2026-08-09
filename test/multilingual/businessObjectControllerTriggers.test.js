import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readController = (name) =>
  fs.readFileSync(new URL(`../../src/controllers/${name}`, import.meta.url), 'utf8');

const readTranslationService = (name) =>
  fs.readFileSync(new URL(`../../src/services/translation/${name}`, import.meta.url), 'utf8');

test('Blog controller queues manual-review translation work on source mutations', () => {
  const source = readController('blogController.js');

  assert.match(source, /requestBulkTranslations/);
  assert.match(source, /businessObjectType: 'blog'/);
  assert.match(source, /sourceContent: \{ title: blog\.title, description: blog\.description \}/);
  assert.match(source, /updateData\.title !== undefined \|\| updateData\.description !== undefined/);
  assert.match(source, /markObjectTranslationsOutdated/);
});

test('FAQ controller maps question and answer before queuing translation work', () => {
  const source = readController('faqController.js');

  assert.match(source, /requestBulkTranslations/);
  assert.match(source, /businessObjectType: 'faq'/);
  assert.match(source, /sourceContent: \{ title: faq\.question, description: faq\.answer \}/);
  assert.match(source, /question !== undefined \|\| answer !== undefined/);
  assert.match(source, /markObjectTranslationsOutdated/);
});

test('Listing controller queues generation immediately and refreshes it on source updates', () => {
  const source = readController('listingController.js');

  assert.match(source, /requestBulkTranslations/);
  assert.match(source, /businessObjectType: 'listing'/);
  assert.match(source, /sourceContent: \{ title: listing\.title, description: listing\.description \}/);
  assert.match(source, /await triggerListingTranslations\(newListing, req\.user\._id\)/);
  assert.match(source, /updateData\.title !== undefined \|\| updateData\.description !== undefined/);
  assert.match(source, /markObjectTranslationsOutdated/);
});

test('Listing approval publishes ready translations through the approval-gated workflow', () => {
  const source = readController('adminController.js');
  const workflow = readTranslationService('publishingWorkflowService.js');

  assert.match(source, /if \(status === 'approved'\) \{/);
  assert.match(source, /applyAutomaticPublicationForObject\(\{/);
  assert.match(source, /businessObjectType: 'listing'/);
  assert.match(source, /masterState: \{ status: listing\.status \}/);
  assert.match(workflow, /publicationStatus: 'draft'/);
  assert.match(workflow, /translationStatus: \{ \$ne: 'failed' \}/);
  assert.match(workflow, /expectedVersion: record\.versionNumber/);
});

test('Creator Profile controller queues application and source update translations', () => {
  const source = readController('userController.js');

  assert.match(source, /businessObjectType: 'creatorProfile'/);
  assert.match(source, /name: user\.profile\?\.displayName \|\| user\.profile\?\.businessName/);
  assert.match(source, /bio: user\.profile\?\.bio/);
  assert.match(source, /sourceSlug: user\.slug/);
  assert.match(source, /await triggerCreatorProfileTranslations\(updatedUser, req\.user\._id\)/);
  assert.match(source, /displayName !== undefined \|\| bio !== undefined/);
  assert.match(source, /markObjectTranslationsOutdated/);
});

test('Creator approval publishes ready profile translations through the approval gate', () => {
  const source = readController('adminController.js');

  assert.match(source, /businessObjectType: 'creatorProfile'/);
  assert.match(source, /creatorRequestStatus: user\.creatorRequest\.status/);
  assert.match(source, /recipient: user\._id/);
});

test('Category controller queues manual-review translations on create and title update', () => {
  const source = readController('adminController.js');

  assert.match(source, /businessObjectType: 'category'/);
  assert.match(source, /sourceContent: \{ title: category\.title \}/);
  assert.match(source, /await triggerCategoryTranslations\(category, req\.user\._id\)/);
  assert.match(source, /triggerCategoryTranslations\(updatedCategory, req\.user\._id, \{ sourceChanged: true \}\)/);
  assert.match(source, /markObjectTranslationsOutdated/);
});

test('CMS controllers queue About, Footer, and How-it-works translation work', () => {
  const aboutSource = readController('aboutController.js');
  const footerSource = readController('footerController.js');
  const adminSource = readController('adminController.js');

  assert.match(aboutSource, /triggerCmsTranslations/);
  assert.match(aboutSource, /cmsKey: 'about'/);
  assert.match(footerSource, /triggerCmsTranslations/);
  assert.match(footerSource, /cmsKey: 'footer'/);
  assert.match(adminSource, /triggerCmsTranslations/);
  assert.match(adminSource, /cmsKey: 'how-it-works'/);
  assert.match(adminSource, /sourceChanged: true/);
});
