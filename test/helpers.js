'use strict';

const fs = require('fs-extra');
const _ = require('lodash');
const tmp = require('tmp');
const path = require('path');
const Registry = require('../lib/registry');
const Manager = require('../index.js');
const Sandbox = require('nami-test').Sandbox;
const samplePackagesDir = path.join(__dirname, 'data/sample-packages');
const sampleRegistriesDir = path.join(__dirname, 'data/sample-registries');


function _fileExists(f) {
  try {
    fs.lstatSync(f);
    return true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return false;
  }
}

function listDirRecursively(dir, options) {
  if (!_fileExists(dir)) return [];

  options = _.defaults(options || {}, {prefix: ''});
  let res = [];
  _.each(fs.readdirSync(dir), function(p) {
    const fullPath = path.join(dir, p);
    const stats = fs.lstatSync(fullPath);
    res.push(path.join(options.prefix, p));
    if (stats.isDirectory()) {
      res = res.concat(listDirRecursively(fullPath, {prefix: path.join(options.prefix, p)}));
    }
  });
  return res.sort();
}

function _compareDirLists(list1, list2, options) {
  options = _.defaults(options || {}, {prettify: false});
  if (options.prettify) {
    const diff1 = _.difference(list1, list2);
    const diff2 = _.difference(list2, list1);
    return _.map(diff1, e => `-${e}`).concat(_.map(diff2, e => `+${e}`));
  } else {
    return _.xor(list1, list2);
  }
}
function diffDirs(dir1, dir2, options) {
  return _compareDirLists(listDirRecursively(dir1), listDirRecursively(dir2), options);
}

const temporaryFiles = [];
const cleanupOperations = [];
function cleanUpTemporaryFiles() {
  _.each(temporaryFiles, function(f) {
    fs.removeSync(f);
  });
  _.each(cleanupOperations, cb => cb());
}

process.on('exit', cleanUpTemporaryFiles);

function getTemporaryFile(tail) {
  let file = tmp.tmpNameSync();
  temporaryFiles.push(file);
  if (tail) {
    file = path.join(file, tail);
    temporaryFiles.push(file);
  }
  return file;
}

function getNewManager(options) {
  options = _.defaults(options || {}, {sampleRegistry: null, registryPrefix: null});
  const namiRegistryDir = options.registryPrefix || getTemporaryFile('.nami');
  const namiInstallRoot = getTemporaryFile();
  if (options.sampleRegistry) {
    fs.copySync(path.join(sampleRegistriesDir, options.sampleRegistry), namiRegistryDir);
  }
  const managerOpts = {registryPrefix: namiRegistryDir, installationPrefix: namiInstallRoot};
  _.each(['encryptionPassword'], function(key) {
    if (_.has(options, key)) managerOpts[key] = options[key];
  });
  return new Manager(managerOpts);
}

function copySampleRegistry(sample, registryDir) {
  registryDir = registryDir || getTemporaryFile('.nami');
  fs.copySync(path.join(sampleRegistriesDir, sample), registryDir);
}
function getNewRegistry(options) {
  options = _.defaults(options || {}, {sampleRegistry: null});
  const namiRegistryDir = getTemporaryFile('.nami');
  if (options.sampleRegistry) {
    copySampleRegistry(options.sampleRegistry, namiRegistryDir);
  }
  return new Registry({prefix: namiRegistryDir});
}

function samplePackageFromScratch(options) {
  options = _.defaults(options || {}, {
    filesManifest: null, name: 'sample', id: 'sample', version: '1.0.0',
    extends: ['Component'], revision: 0, mainJS: null, namiJson: null,
    helpersJS: null, exports: {}, expects: null, properties: {}, templates: {},
    components: null, service: null, raw: {}
  });
  const name = options.name || options.id || 'sample';
  const id = options.id || name;
  const sb = new Sandbox();
  cleanupOperations.push(() => sb.cleanup());
  const rootDir = sb.mkdir(id);
  const objDefinition = _.pick(options, ['version', 'revision', 'extends', 'properties', 'exports']);
  if (options.service) objDefinition.service = options.service;

  _.extend(objDefinition, {id: id, name: name});

  if (!_.isEmpty(options.raw)) {
    _.defaultsDeep(objDefinition, options.raw);
  }
  if (options.components) {
    objDefinition.installation = objDefinition.installation || {};
    objDefinition.installation = _.defaultsDeep(
      objDefinition.installation || {}, {
        packaging: {
          components: options.components
        }
      }
    );
  }
  if (options.expects) objDefinition.expects = options.expects;
  fs.mkdirpSync(rootDir);
  _.each({
    'nami.json': options.namiJson || JSON.stringify(objDefinition),
    'main.js': options.mainJS || '',
    'helpers.js': options.helpersJS || ''
  }, function(text, file) {
    fs.writeFileSync(path.join(rootDir, file), text);
  });
  if (!_.isEmpty(options.templates)) {
    const templatesDir = path.join(rootDir, 'templates');
    fs.mkdirpSync(templatesDir);
    _.each(options.templates, function(templateText, templateName) {
      fs.writeFileSync(path.join(templatesDir, templateName), templateText);
    });
  }
  if (options.filesManifest) {
    const manifestData = {};
    manifestData[`${id}/files`] = options.filesManifest;
    sb.createFilesFromManifest(manifestData);
  }
  return rootDir;
}

function generateSamplePkgData(options) {
  const dir = samplePackageFromScratch(options);
  const data = {jsFiles: [], jsonFile: path.join(dir, 'nami.json')};
  if (options.mainJS) data.jsFiles.push(path.join(dir, 'main.js'));
  if (options.helpersJS) data.jsFiles.push(path.join(dir, 'helpers.js'));
  return data;
}
function copySamplePackage(name) {
  const tmpDir = getTemporaryFile(name);
  fs.copySync(path.join(samplePackagesDir, name), tmpDir);
  return tmpDir;
}

function _install(pkgDir, options) {
  options = _.defaults(options || {}, {manager: null});
  const manager = options.manager || getNewManager();
  return manager.install(pkgDir);
}
function installSamplePackage(name, options) {
  const pkgDir = copySamplePackage(name);
  return _install(pkgDir, options);
}

function installPackageFromScratch(pkgOptions, options) {
  const pkgDir = samplePackageFromScratch(pkgOptions);
  return _install(pkgDir, options);
}

function writeTemporaryFile(code) {
  const file = tmp.tmpNameSync();
  fs.writeFileSync(file, code);
  temporaryFiles.push(file);
  return file;
}

_.extend(exports, {
  getTemporaryFile,
  writeTemporaryFile,
  cleanUpTemporaryFiles,
  copySamplePackage,
  samplePackageFromScratch,
  installPackageFromScratch,
  generateSamplePkgData,
  getNewRegistry,
  copySampleRegistry,
  getNewManager,
  listDirRecursively,
  diffDirs,
  installSamplePackage
});
