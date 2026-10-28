#!/usr/bin/env node
// Captures a `cloakpipe` binary's commands and flags from its --help output,
// in the shape of test/fixtures/cli-*.json, which the docs tests check every
// documented `cloakpipe ...` command against:
//
//   node scripts/cli-fixture.mjs <path/to/cloakpipe> "<source note>" [previous fixture] > test/fixtures/cli-vX.json
//
// --help does not show hidden flags or the separate cloakpipe-verify binary,
// so `hidden` and `cloakpipe-verify` are copied from the previous fixture.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [bin, source, previous] = process.argv.slice(2);
if (!bin || !source) {
  console.error('usage: cli-fixture.mjs <cloakpipe binary> "<source note>" [previous fixture]');
  process.exit(2);
}

const help = (path) => execFileSync(bin, [...path, '--help'], { encoding: 'utf8' });

/** The flags and subcommands one --help page lists. */
function parse(text) {
  const flags = new Set();
  const subs = [];
  let section = '';
  for (const line of text.split('\n')) {
    if (/^\S.*:$/.test(line)) section = line;
    else if (section === 'Commands:') {
      const m = /^ {2}([a-z][a-z0-9-]*)\s/.exec(line);
      if (m && m[1] !== 'help') subs.push(m[1]);
    } else if (section === 'Options:') {
      const m = /^\s+(?:-[A-Za-z], )?(--[a-z][a-z0-9-]*)/.exec(line);
      if (m) flags.add(m[1]);
    }
  }
  return { flags: [...flags].sort(), subs };
}

const commands = {};
function walk(path) {
  const { flags, subs } = parse(help(path));
  commands[path.length ? path.join(' ') : '(root)'] = flags;
  for (const s of subs) walk([...path, s]);
}
walk([]);

const old = previous ? JSON.parse(readFileSync(previous, 'utf8')) : {};
const out = {
  source,
  commands,
  hidden: old.hidden ?? {},
  'cloakpipe-verify': old['cloakpipe-verify'] ?? [],
};
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
