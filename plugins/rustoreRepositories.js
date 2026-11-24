const RUSTORE_MAVEN_URL = 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed';
const MY_TARGET_MAVEN_URL = 'https://artifactory-external.vkpartner.ru/artifactory/maven';
const OLD_RUSTORE_MAVEN_URL = MY_TARGET_MAVEN_URL + '-rustore-exposed';
const TRACER_MAVEN_URL = 'https://nexus-external.vkteam.ru/repository/maven-tracer-public-exposed';

// Keep offsets and newlines while ignoring braces/keywords inside Groovy literals and comments.
function codeOnly(contents) {
  return contents.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,
    (literal) => literal.replace(/[^\r\n]/g, ' '));
}

function closingBrace(code, opening) {
  let depth = 1;
  for (let index = opening + 1; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    if (code[index] === '}' && --depth === 0) return index;
  }
  throw new Error('RuStore: repository block has unbalanced braces');
}

/** Only the generated allprojects.repositories block is supported, never buildscript repositories. */
function updateProjectRepositories(contents, update) {
  const code = codeOnly(contents);
  const matches = [...code.matchAll(/\ballprojects\s*\{\s*repositories\s*\{/g)];
  if (matches.length !== 1) {
    throw new Error('RuStore: one allprojects.repositories block was not found in android/build.gradle');
  }
  closingBrace(code, matches[0].index + matches[0][0].indexOf('{'));
  const start = matches[0].index + matches[0][0].length;
  const end = closingBrace(code, start - 1);
  return contents.slice(0, start) + update(contents.slice(start, end), contents.includes('\r\n') ? '\r\n' : '\n')
    + contents.slice(end);
}

function validateTargetRepository(block, urlEnd) {
  let remainder = block.slice(urlEnd, -1).trim();
  if (!remainder) return [];
  const content = remainder.match(/^content\s*\{([\s\S]*)\}\s*;?$/);
  if (!content) throw new Error('RuStore: unsupported repository clause; preserve it before migrating');
  const groups = [];
  remainder = content[1].replace(/\bincludeGroup(ByRegex)?\s*(?:\(\s*)?(['"])([^'"]+)\2\s*\)?\s*;?/g,
    (directive, byRegex, quote, group) => {
      // Unknown expressions can include foreign groups even when they start with a RuStore prefix.
      const supportedGroups = byRegex
        ? ['ru[.]rustore([.].*)?', 'com[.]my[.]target', 'ru[.]ok[.]tracer']
        : ['ru.rustore.sdk', 'com.my.target', 'ru.ok.tracer'];
      if (!supportedGroups.includes(group)) {
        throw new Error('RuStore: unsupported repository group; preserve it before migrating');
      }
      groups.push(group);
      return '';
    });
  if (remainder.trim()) throw new Error('RuStore: unsupported repository content; preserve it before migrating');
  return groups;
}

function patchRuStoreRepositories(contents, { includeMyTarget = false, includePushTracer = false } = {}) {
  return updateProjectRepositories(contents, (repositories, newline) => {
    const code = codeOnly(repositories);
    const pattern = /\bmaven\s*\{/g;
    const removals = [];
    let keepMyTarget = includeMyTarget;
    let keepTracer = includePushTracer;
    for (const match of code.matchAll(pattern)) {
      const end = closingBrace(code, match.index + match[0].length - 1) + 1;
      const block = repositories.slice(match.index, end);
      const url = block.match(/^maven\s*\{\s*url\s*(?:=\s*)?(?:(?:uri\s*)?\(\s*)?(['"])([^'"]+)\1\s*\)?\s*;?\s*/);
      const repositoryUrl = url?.[2].replace(/\/+$/, '');
      const targetUrls = [RUSTORE_MAVEN_URL, MY_TARGET_MAVEN_URL, OLD_RUSTORE_MAVEN_URL, TRACER_MAVEN_URL];
      if (!url || !targetUrls.includes(repositoryUrl)) {
        if (!url && targetUrls.some((value) => block.includes(value))) {
          throw new Error('RuStore: unsupported repository URL declaration');
        }
        continue;
      }
      const depth = [...code.slice(0, match.index)].reduce((value, char) => value + (char === '{' ? 1 : char === '}' ? -1 : 0), 0);
      if (depth !== 0) throw new Error('RuStore: nested repository declaration is not supported');
      const groups = validateTargetRepository(block, url[0].length);
      if (repositoryUrl === MY_TARGET_MAVEN_URL || groups.some((group) => ['com.my.target', 'com[.]my[.]target'].includes(group))) keepMyTarget = true;
      if (repositoryUrl === TRACER_MAVEN_URL || groups.some((group) => ['ru.ok.tracer', 'ru[.]ok[.]tracer'].includes(group))) keepTracer = true;
      let start = match.index;
      let finish = end;
      const lineStart = repositories.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = repositories.indexOf('\n', finish);
      if (!repositories.slice(lineStart, start).trim()
        && !repositories.slice(finish, lineEnd < 0 ? repositories.length : lineEnd).trim()) {
        start = lineStart;
        finish = lineEnd < 0 ? repositories.length : lineEnd + 1;
      }
      removals.push([start, finish]);
    }
    let next = repositories;
    for (const [start, end] of removals.reverse()) next = next.slice(0, start) + next.slice(end);
    const closingIndent = repositories.match(/(?:^|\r?\n)([ \t]*)$/)?.[1] ?? '  ';
    const indent = closingIndent + '  ';
    const declaration = (url, filter) => `${indent}maven { url '${url}'; content { ${filter} } }`;
    return next.trimEnd() + newline + declaration(RUSTORE_MAVEN_URL, "includeGroupByRegex 'ru[.]rustore([.].*)?'")
      + (keepMyTarget ? newline + declaration(MY_TARGET_MAVEN_URL, "includeGroupByRegex 'com[.]my[.]target'") : '')
      + (keepTracer ? newline + declaration(TRACER_MAVEN_URL, "includeGroup 'ru.ok.tracer'") : '')
      + newline + closingIndent;
  });
}

module.exports = { patchRuStoreRepositories, updateProjectRepositories };
