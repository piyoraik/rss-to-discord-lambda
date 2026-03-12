import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHtmlItems } from '../src/html-parser';

test('parseHtmlItems extracts forum threads from configured selectors', () => {
  const html = `
    <base href="https://forum.square-enix.com/ffxiv/" />
    <ul>
      <li class="threadbit" id="thread_524736">
        <a class="title" id="thread_title_524736" href="threads/524736-example">Thread One</a>
      </li>
      <li class="threadbit" id="thread_524737">
        <a class="title" href="/threads/524737-example">Thread Two</a>
      </li>
    </ul>
  `;

  const items = parseHtmlItems(
    html,
    'https://forum.square-enix.com/ffxiv/forums/537-example',
    'li.threadbit',
    'a.title',
    'a.title'
  );

  assert.equal(items.length, 2);
  assert.equal(items[0]?.identifiers.id, '524736');
  assert.equal(
    items[0]?.link,
    'https://forum.square-enix.com/ffxiv/threads/524736-example'
  );
  assert.equal(items[0]?.title, 'Thread One');
  assert.equal(items[1]?.identifiers.id, '524737');
  assert.equal(
    items[1]?.link,
    'https://forum.square-enix.com/threads/524737-example'
  );
});
