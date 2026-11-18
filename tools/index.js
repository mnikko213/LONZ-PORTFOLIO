// Lets "node --test tools/" work on every Node version: Node 20 searches the folder for *.test.mjs
// by itself, Node 22+ runs the folder as a module, which lands here.
import('./drive-sync.test.mjs');
