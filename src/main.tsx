/**
 * Точка входа (docs/SPEC.md §2.2, §5.2).
 *
 * Порядок стилей важен: kinu → токены (перекрытие) → свои стили.
 */

import { render } from 'preact';
import 'kinu/style.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './app';
import { registerServiceWorker, watchControllerChange } from './sw';

const root = document.getElementById('app');
if (root) render(<App />, root);

watchControllerChange();
registerServiceWorker();
