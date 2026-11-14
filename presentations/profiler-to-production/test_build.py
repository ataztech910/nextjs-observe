"""Protect the audience/notes boundary and escape source text in generated HTML."""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from build import build, inline


class Sections(HTMLParser):
    def __init__(self):
        super().__init__()
        self.audience = []
        self.notes = []
        self.where = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'section':
            self.where = self.audience
        elif tag == 'aside':
            self.where = self.notes

    def handle_data(self, data):
        if self.where is not None:
            self.where.append(data)

    def handle_endtag(self, tag):
        if tag == 'section':
            self.where = None


class BuildContract(unittest.TestCase):
    def test_audience_values_and_private_notes_remain_separate(self):
        self.assertEqual(build(), 10)
        parser = Sections()
        parser.feed(Path(__file__).with_name('index.html').read_text())
        audience = ' '.join(parser.audience)
        notes = ' '.join(parser.notes)
        for value in ['214.2 · 200.8 · 213.3 · 213.6 ms', '1871 B', '8275 B', '+21.433 ms [1.450, 44.650]', 'incomplete', 'failed', 'presentation unavailable']:
            self.assertIn(value, audience)
        self.assertNotIn('The four numbers are block-level differences.', audience)
        self.assertIn('The four numbers are block-level differences.', notes)

    def test_html_and_evidence_links(self):
        self.assertEqual(inline('<script>"unsafe"</script>'), '&lt;script&gt;&quot;unsafe&quot;&lt;/script&gt;')
        self.assertIn('../../docs/research/performance-observability/F_EVIDENCE_MATRIX.md', inline('[Evidence](F_EVIDENCE_MATRIX.md)'))
        for bad in ['[x](javascript:alert)', '[x](https://external.invalid)', '[x](../../outside.md)']:
            with self.assertRaises(ValueError):
                inline(bad)

    def test_embedded_assets_and_deterministic_output(self):
        root = Path(__file__).parent
        build()
        before = (root/'index.html').read_bytes()
        build()
        self.assertEqual(before, (root/'index.html').read_bytes())
        text = before.decode()
        self.assertEqual(len(re.findall(r'<section class="slide ', text)), 10)
        self.assertNotIn('<script src=', text)
        self.assertNotIn('<!-- SLIDES -->', text)
        self.assertNotIn('/* STYLES */', text)


if __name__ == '__main__':
    unittest.main()
