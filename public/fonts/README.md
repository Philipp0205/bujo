# Fonts

Self-hosted for the paper look of the rapid log. Every family is licensed under the SIL Open Font License 1.1
(https://openfontlicense.org). The licence text of each new family sits beside the files.

| File | Family | Used for |
| --- | --- | --- |
| `newsreader.woff2` | Newsreader (variable, upright) | titles, entries, day headings (the default text face) |
| `newsreader-italic.woff2` | Newsreader (variable, italic) | the page title, day headings, labels |
| `literata.woff2`, `literata-italic.woff2` | Literata (variable, Latin) | the journal text when chosen in settings |
| `source-serif-4.woff2`, `source-serif-4-italic.woff2` | Source Serif 4 (variable, Latin) | the journal text when chosen in settings |
| `lora.woff2`, `lora-italic.woff2` | Lora (variable, Latin) | the journal text when chosen in settings |
| `ibm-plex-sans.woff2` | IBM Plex Sans (variable) | meta lines, buttons |
| `caveat-latin.woff2`, `caveat-latin-ext.woff2` | Caveat 400 | the status words after a title (waiting to send, not synced) |
| `caveat-latin-600.woff2`, `caveat-latin-ext-600.woff2` | Caveat 600 | the handwritten tags and time after a title |

Newsreader is by Production Type. IBM Plex Sans is by IBM. Caveat is by Impallari Type (licence text in `OFL-Caveat.txt`).
Literata is by the Literata Project Authors (`OFL-Literata.txt`), Source Serif 4 by Adobe (`OFL-Source-Serif-4.txt`) and
Lora by the Lora Project Authors (`OFL-Lora.txt`). The new woff2 files are the Latin subsets from the Fontsource packages
`@fontsource-variable/literata`, `source-serif-4` and `lora`. German umlauts and the sharp s are in the Latin subset.
They are loaded from `public/css/paper.css`. The saved choice is `html[data-font]`, set by `public/js/font/boot.js`.
