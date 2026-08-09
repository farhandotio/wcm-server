import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFrenchFaqs } from '../../src/controllers/faqController.js';

const sourceFaqs = [
  { _id: 'faq-1', question: 'English question one', answer: 'English answer one', category: 'General' },
  { _id: 'faq-2', question: 'English question two', answer: 'English answer two', category: 'Technical' },
];

test('FAQ default projection preserves English content', () => {
  assert.deepEqual(projectFrenchFaqs(sourceFaqs, []), sourceFaqs);
});

test('FAQ French projection uses only the published translation query result', () => {
  const result = projectFrenchFaqs(sourceFaqs, [{
    businessObjectId: 'faq-1',
    content: { title: 'Question française', description: 'Réponse française' },
  }]);

  assert.equal(result[0].question, 'Question française');
  assert.equal(result[0].answer, 'Réponse française');
});

test('FAQ French projection falls back to English for an untranslated FAQ', () => {
  const result = projectFrenchFaqs(sourceFaqs, [{
    businessObjectId: 'faq-1',
    content: { title: 'Question française', description: 'Réponse française' },
  }]);

  assert.equal(result[1].question, 'English question two');
  assert.equal(result[1].answer, 'English answer two');
});
