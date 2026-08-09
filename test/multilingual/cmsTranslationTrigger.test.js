import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCmsTranslatableContent } from '../../src/services/translation/cmsTranslationTrigger.js';
import { DEFAULT_PUBLISHING_POLICIES } from '../../src/services/translation/publishingWorkflowService.js';

test('CMS translation content keeps visitor text and excludes master-only fields', () => {
  const content = buildCmsTranslatableContent({
    _id: 'cms-id',
    pageName: 'how-it-works',
    headerTitle: 'How it works',
    styleSettings: { backgroundColor: '#000000' },
    steps: [{ id: 1, iconId: 'search', title: 'Explore', description: 'Discover culture' }],
    links: [{ label: 'About', href: '/about' }],
  });

  assert.deepEqual(content, {
    content: {
      headerTitle: 'How it works',
      steps: [{ title: 'Explore', description: 'Discover culture' }],
      links: [{ label: 'About' }],
    },
  });
});

test('CMS translations remain manual-review drafts by default', () => {
  assert.equal(DEFAULT_PUBLISHING_POLICIES.cms.publicationMode, 'manual_review');
});
