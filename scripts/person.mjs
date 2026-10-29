#!/usr/bin/env node
// Who is editing on this computer. Their name goes on every saved change.
//   node person.mjs                          show the saved name
//   node person.mjs --name "Asha Rao" --email asha@example.com
import path from 'node:path';
import { requireRepo, loadPerson, writeJson, ensureLocalIgnores, PERSON_REL, parseArgs, emit, gitOut } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = requireRepo();
ensureLocalIgnores(root);

if (args.name) {
  const name = String(args.name).trim();
  const email = String(args.email || '').trim();
  if (!/\S+\s*\S*/.test(name) || name === 'true') { console.error('Give a real name, e.g. --name "Asha Rao".'); process.exit(1); }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('That email does not look right.'); process.exit(1); }
  const person = { name, email, role: String(args.role || 'SEO'), savedAt: new Date().toISOString() };
  writeJson(path.join(root, PERSON_REL), person);
  emit({ ok: true, person }, `Saved. Changes will be signed as: ${name}${email ? ` <${email}>` : ''}`);
} else {
  const person = loadPerson(root);
  const gitName = gitOut(['config', 'user.name'], root);
  const gitEmail = gitOut(['config', 'user.email'], root);
  emit({ ok: !!person, person, gitName, gitEmail },
    person ? `Editor: ${person.name}${person.email ? ` <${person.email}>` : ''}`
      : `No editor saved yet.${gitName ? ` Git knows this computer as "${gitName}${gitEmail ? ` <${gitEmail}>` : ''}" - confirm with the person before using it.` : ''}`);
  process.exit(person ? 0 : 3);
}
