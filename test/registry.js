/* eslint-disable no-unused-expressions */
'use strict';
const chai = require('chai');
const chaiFs = require('chai-fs');
const expect = chai.expect;
const fs = require('fs-extra');
const _ = require('lodash');
const path = require('path');
const testHelpers = require('./helpers.js');
const getTemporaryFile = testHelpers.getTemporaryFile;
const getNewRegistry = testHelpers.getNewRegistry;
const copySampleRegistry = testHelpers.copySampleRegistry;

chai.use(chaiFs);

describe('NamiRegistry', function() {
  let registry = null;
  beforeEach(function() {
    registry = getNewRegistry();
  });
  after(function() {
    testHelpers.cleanUpTemporaryFiles();
  });
  describe('#load()', function() {
    beforeEach(function() {
      registry = getNewRegistry();
    });
    it('Starts empty', function() {
      expect(registry.getPackages()).to.eql({});
    });
    it('Loads sample registry', function() {
      expect(registry.getPackages()).to.eql({});
      copySampleRegistry('minimal', registry.prefix);
      registry.load();
      const ids = _.keys(registry.getPackages());
      expect(ids).to.eql(['A', 'B', 'C', 'D']);
    });
  });
  describe('#loadPackage()', function() {
    beforeEach(function() {
      registry = getNewRegistry({sampleRegistry: 'dependencies'});
      registry.load();
    });
    it('Loads package from registry', function() {
      const obj = registry.loadPackage('A');
      // Just some well know properties a package should have
      _.each(['preUninstallation', 'preInstallChecks'], function(p) {
        expect(obj).to.have.property(p);
      });
      expect(obj.exports.test()).to.be.eql('It works!');
    });
    it('By default, caches loaded packages', function() {
      const obj1 = registry.loadPackage('A');
      const obj2 = registry.loadPackage('A');
      expect(obj1).to.be.eql(obj2);
    });
    it('Allows reloading packages', function() {
      const obj1 = registry.loadPackage('A');
      const obj2 = registry.loadPackage('A', {reload: true});
      expect(obj1).to.not.be.eql(obj2);
    });
  });
  describe('#loadPackageFromDir()', function() {
    it('Loads package from from a directory', function() {
      const dir = testHelpers.samplePackageFromScratch({name: 'sample_pkg'});
      const obj = registry.loadPackageFromDir(dir);
      expect(obj.evalCode(`$app.name`)).to.be.eql('sample_pkg');
    });
    describe('JSON validations', function() {
      const minimalData = {id: 'com.bitnami.minipackage', name: 'minipackage', version: '1.3.4'};
      it('Throws on malformed JSON files', function() {
        const dir = testHelpers.samplePackageFromScratch({namiJson: 'malformed json data'});
        expect(function() {
          registry.loadPackageFromDir(dir);
        }).throw(/Parse error on line 1[\S\s]*malformed json data/);
      });
      it('Throws on missing mandatory keys', function() {
        _.each(['id', 'version'], function(field) {
          const insufficientData = _.omit(minimalData, field);
          const dir = testHelpers.samplePackageFromScratch({namiJson: JSON.stringify(insufficientData)});
          expect(function() {
            registry.loadPackageFromDir(dir);
          }).throw(`"${field}" is required`);
        });
        const dir = testHelpers.samplePackageFromScratch({namiJson: JSON.stringify(minimalData)});
        expect(function() {
          registry.loadPackageFromDir(dir);
        }).to.not.throw();
      });
      it('Throws on wrong format for keys', function() {
        _.each({id: 123, name: ['dummy'], version: 4}, function(value, field) {
          const incorrectData = _.cloneDeep(minimalData);
          incorrectData[field] = value;
          const dir = testHelpers.samplePackageFromScratch({namiJson: JSON.stringify(incorrectData)});
          expect(function() {
            registry.loadPackageFromDir(dir);
          }).throw(`child "${field}" fails because ["${field}" must be`);
        });
      });
      it('Throws if service type components do not include the service section', function() {
        const serviceData = _.clone(minimalData);
        serviceData.extends = 'Service';
        // A service with missing 'service key fails'
        expect(function() {
          const dir = testHelpers.samplePackageFromScratch({namiJson: JSON.stringify(serviceData)});
          registry.loadPackageFromDir(dir);
        }).to.throw();
        serviceData.service = {pidFile: 'my.pid', logFile: 'my.log'};
        const dir = testHelpers.samplePackageFromScratch({namiJson: JSON.stringify(serviceData)});
        expect(function() {
          registry.loadPackageFromDir(dir);
        }).to.not.throw();
      });
      it('Allows not throwing errors on schema validations', function() {
        const incorrectData = {
          id: 'com.bitnami.minipackage', name: 'minipackage',
          version: '1.3.4', extends: ['Service']
        };
        const dir = testHelpers.samplePackageFromScratch({namiJson: JSON.stringify(incorrectData)});
        expect(function() {
          registry.loadPackageFromDir(dir);
        }).throw('child "service" fails');
        expect(function() {
          registry.loadPackageFromDir(dir, {}, {softSchemaValidation: true});
        }).to.not.throw();
      });
    });
  });
  describe('Package reqistering and unregistering', function() {
    let registry1 = null;
    let registry2 = null;
    let obj = null;
    function _registerPkgAndTest() {
      registry1 = getNewRegistry({sampleRegistry: 'dependencies'});
      registry2 = getNewRegistry();
      registry1.load();
      obj = registry1.loadPackage('A');
      expect(registry2.databaseFile).to.not.be.a.path();
      registry2.register(obj);
      expect(registry2.getPkgData('A')).to.not.be.eql(null);
      const registryData = JSON.parse(fs.readFileSync(registry2.databaseFile).toString());
      const componentRoot = registryData.components.A.definition.root;
      const componentMetadataDir = path.join(registry2.componentsDir, componentRoot);
      expect(componentMetadataDir).to.be.a.directory();
      expect(path.join(componentMetadataDir, 'nami.json')).to.be.a.file();
      expect(registryData.components).to.have.property('A');
      return {registry: registry2, obj: obj, metadataDir: componentMetadataDir};
    }
    describe('#register()', function() {
      it('Registers new packages', function() {
        _registerPkgAndTest();
      });
    });
    describe('#unregister()', function() {
      it('Unregisters packages', function() {
        const data = _registerPkgAndTest();
        data.registry.unregister(obj);
        expect(data.registry.getPkgData('A')).to.be.eql(null);
        expect(data.metadataDir).to.not.be.a.path();
      });
      it('Allows preserving the metadata dir when unregistering', function() {
        const data = _registerPkgAndTest();
        data.registry.unregister(obj, {delete: false});
        expect(data.registry.getPkgData('A')).to.be.eql(null);
        expect(data.metadataDir).to.be.a.directory();
      });
    });
  });

  describe('#save()', function() {
    it('Allows saving', function() {
      const registry1 = getNewRegistry({sampleRegistry: 'dependencies'});
      registry1.load();
      const registryFile = registry1.databaseFile;
      expect(registryFile).to.be.a.file();
      // We will delete it to ensure the registry can recreate it from memory
      fs.unlinkSync(registryFile);
      expect(registry1.save()).to.be.eql(registryFile);

      expect(registryFile).to.be.a.path();
      const registryData = JSON.parse(fs.readFileSync(registryFile).toString());
      expect(registryData.components).to.have.property('A');
    });
    it('Allows saving to an specific file', function() {
      const registry1 = getNewRegistry({sampleRegistry: 'dependencies'});
      registry1.load();
      const file = getTemporaryFile();
      expect(file).to.not.be.a.path();
      expect(registry1.save({file: file})).to.be.eql(file);
      expect(file).to.be.a.file();
      const registryData = JSON.parse(fs.readFileSync(file).toString());
      expect(registryData.components).to.have.property('A');
    });
  });
  describe('#deserializePackage()', function() {
    beforeEach(function() {
      registry = getNewRegistry({sampleRegistry: 'minimal'});
      registry.load();
    });
    const samplePackageData = {
      name: 'sample_pkg', id: 'com.bitnami.sample_pkg', version: '1.2.3',
      exports: {test: {}}, properties: {sample_arg: {}},
      mainJS: `$app.exports.test = function() { return 'It works!' };`
    };
    it('De-serializes package from regular directory', function() {
      const obj = registry.deserializePackage(testHelpers.generateSamplePkgData(samplePackageData));
      expect(obj.version).to.be.eql('1.2.3');
      expect(obj.evalCode(`$app.name`)).to.be.eql('sample_pkg');
      expect(obj.exports.test()).to.be.eql('It works!');
      expect(obj.lifecycle).to.be.eql(null);
    });
    it('De-serializes package from regular directory with extra options', function() {
      const obj = registry.deserializePackage(
        _.extend(testHelpers.generateSamplePkgData(samplePackageData), {
          data: {values: {sample_arg: 'asdf'}, lifecycle: 'installed'}
        })
      );
      expect(obj.lifecycle).to.be.eql('installed');
      expect(obj.sample_arg).to.be.eql('asdf');
    });
  });
});
