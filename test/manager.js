/* eslint-disable no-unused-expressions */
'use strict';
const chai = require('chai');
const chaiFs = require('chai-fs');
const chaiSubset = require('chai-subset');
const expect = chai.expect;
const fs = require('fs-extra');
const _ = require('lodash');
const path = require('path');
const crypto = require('crypto');
const testHelpers = require('./helpers.js');
const writeTemporaryFile = testHelpers.writeTemporaryFile;
const samplePackageFromScratch = testHelpers.samplePackageFromScratch;
const copySamplePackage = testHelpers.copySamplePackage;
const getNewManager = testHelpers.getNewManager;

chai.use(chaiSubset);
chai.use(chaiFs);

describe('Manager', function() {
  let manager = null;
  function installSamplePackage(name) {
    return testHelpers.installSamplePackage(name, {manager: manager});
  }
  beforeEach(function() {
    manager = getNewManager();
  });
  after(function() {
    testHelpers.cleanUpTemporaryFiles();
  });
  describe('#listPackages()', function() {
    beforeEach(function() {
      manager = getNewManager({sampleRegistry: 'minimal'});
    });
    it('Lists installed packages', function() {
      const result = manager.listPackages();
      const ids = _.pluck(_.sortBy(result, 'id'), 'id');
      expect(ids).to.be.an('array').and.to.eql(['A', 'B', 'C', 'D']);
    });
  });
  describe('#inspectPackage', function() {
    beforeEach(function() {
      manager = getNewManager({sampleRegistry: 'minimal'});
    });
    it('Allows inspecting an installed package', function() {
      expect(manager.inspectPackage('A')).to.containSubset({
        id: 'A', name: 'A-name', version: '1.0.0', revision: 1,
        lifecycle: 'installed', installdir: '/opt/bitnami/A',
        installPrefix: '/opt/bitnami', installedAsRoot: false,
        extends: ['Component'], environment: {},
        exports: []
      });
    });
  });
  describe('#evalFile()', function() {
    it('Exposes nami well known $ modules', function() {
      // Just a very basic test to ensure the global vars are there
      const script = `
const _ = require('lodash');
const existingModules = [];
const modules = [$modules, $hb, $manager, $util, $file, $os, $build, $net, $crypt];
_.each(modules, function(m) {
if (_.isObject(m)) existingModules.push(m);
})
existingModules.length === modules.length ? 'OK' : 'FAIL';
`;
      expect(manager.evalFile(writeTemporaryFile(script))).to.eql('OK');
    });
    it('Allows executing scripts in the context of an installed package', function() {
      manager = getNewManager({sampleRegistry: 'minimal'});
      expect(manager.evalFile(
        writeTemporaryFile('$app.id'),
        {package: 'A'}
      )).to.eql('A');
    });
    it('Errors in the execution are properly reported back', function() {
      // Thrown error
      expect(function() {
        manager.evalFile(writeTemporaryFile('throw new Error(\'This is a sample error\')'));
      }).to.throw('This is a sample error');
      // Accidental error
      expect(function() {
        manager.evalFile(writeTemporaryFile('foo()'));
      }).to.throw(/foo is not defined/);
      // Syntax error
      expect(function() {
        manager.evalFile(writeTemporaryFile('.'));
      }).to.throw(/Unexpected token/);
    });

    it('Last line result is reported back', function() {
      expect(manager.evalFile(writeTemporaryFile(`
const a = 124;
const b = 300;
a + b;
`))).to.eql(424);
    });
  });

  describe('#search()', function() {
    beforeEach(function() {
      manager = getNewManager({sampleRegistry: 'multiversions'});
    });
    it('Finds a package by id without version', function() {
      const result = manager.search('foo');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('id', 'foo');
    });
    it('Finds a package by name without version', function() {
      const result = manager.search('foo-name');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('name', 'foo-name');
    });
    it('Finds a package by name with version', function() {
      const result = manager.search('foo-name@>4.3.1 || =1.1.0');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('name', 'foo-name');
    });
    it('By default, gives preference to id vs name when searching', function() {
      let result = manager.search('foo');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('id', 'foo');

      result = manager.search('foo@>1.0');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('id', 'foo');
    });
    it('Allows configuring the search order', function() {
      const result = manager.search('foo', {searchBy: ['name', 'id']});
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('id', 'bar');
    });
    it('Allows only searching by name', function() {
      // Make sure the package is there
      const result = manager.search('com.bitnami.sample2');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('name', 'com.bitnami.sample2-name');
      expect(function() {
        manager.search('com.bitnami.sample2', {searchBy: ['name']});
      }).to.throw(/Cannot find any module matching the provided specification/);
    });
    it('Allows only searching by id', function() {
      // Make sure the package is there
      const result = manager.search('com.bitnami.sample1-name');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('id', 'com.bitnami.sample1');
      expect(function() {
        manager.search('com.bitnami.sample1-name', {searchBy: ['id']});
      }).to.throw(/Cannot find any module matching the provided specification/);
    });

    it('Tries to find by name if succeeded by id but the version check did not match', function() {
      const result = manager.search('foo@>2.0.0');
      expect(result).to.be.an('array').and.to.have.length(1);
      expect(result[0]).to.have.property('id', 'bar');
    });
    it('Returns a plain component instead of a list when enabling requestSingleResult', function() {
      const result = manager.search('foo@>1.0.0', {requestSingleResult: true});
      expect(result).to.not.be.an('array');
      expect(result).to.have.property('id', 'foo');
    });
    it('Throws if a package is not found', function() {
      expect(function() {
        manager.search('asdf');
      }).to.throw(/Cannot find any module matching the provided specification/);
    });
    it('Does not finds a package if its version is not right', function() {
      expect(function() {
        manager.search('foo');
      }).to.not.throw(Error);
      expect(function() {
        manager.search('foo@<1.0.0');
      }).to.throw(/Cannot find any module matching the provided specification/);
    });
    _.each({
      'By default, caches results': {
        validation: (obj1, obj2) => expect(obj1).to.be.eql(obj2)
      },
      'Supports reloading results': {
        reloadOptions: {reload: true},
        validation: (obj1, obj2) => expect(obj1).to.not.be.eql(obj2)
      }
    }, function(testSpec, title) {
      it(title, function() {
        const validation = testSpec.validation;
        const reloadOptions = _.defaults(testSpec.reloadOptions || {}, {requestSingleResult: true});
        const searchSpec = 'foo@>1.0.0';
        const obj1 = manager.search(searchSpec, reloadOptions);
        const obj2 = manager.search(searchSpec, reloadOptions);
        expect(obj1).to.have.property('id', 'foo');
        expect(obj2).to.have.property('id', 'foo');
        validation(obj1, obj2);
      });
    });
    it('By default, allows returning multiple results', function() {
      const result = manager.search('duplicated_name');
      expect(result).to.be.an('array').and.to.have.length(2);
    });
    it('Throws if multiple results were found and was instructed to return a single one', function() {
      expect(function() {
        manager.search('duplicated_name', {requestSingleResult: true});
      }).to.throw(/Found multiple occurrences for the specified term/);
    });
  });

  describe('Installation commands', function() {
    const unpackSteps = ['preInstallChecks', 'preInstallation', 'preUnpackFiles', 'postUnpackFiles'];
    const postInstallSteps = ['postInstallation'];
    const allInstallSteps = unpackSteps.concat(postInstallSteps);
    function createArgumentParsingTests(deploymentMode) {
      _.each(['raw', 'hash'], function(argsMode) {
        const msg = `Accepts parameters in ${argsMode} format`;
        const samplePkgParametersData = {
          // password: [initialValue, newvalue]
          password: ['', 'asdfasdf'],
          force: [false, true],
          start_services: [true, false]
        };
        function validateComponentProperties(comp, properties) {
          _.each(properties, function(value, key) {
            expect(comp[key]).to.be.eql(value);
          });
        }
        const initialValues = {};
        const newValues = {};
        const rawArgs = [];
        const hashArgs = {};
        _.each(samplePkgParametersData, function(values, key) {
          const initialValue = values[0];
          const newValue = values[1];
          initialValues[key] = initialValue;
          newValues[key] = newValue;
          rawArgs.push(`--${key}=${newValue}`);
          hashArgs[key] = newValue;
        });
        const initializationOpts = argsMode === 'raw' ? {args: rawArgs} : {hashArgs: hashArgs};
        it(msg, function() {
          const sampleID = 'parameters-test';
          const pkgDir = copySamplePackage(sampleID);
          let component = null;
          if (deploymentMode === 'initialize') {
            component = manager.unpack(pkgDir);
            expect(component.lifecycle).to.be.eql('unpacked');
            validateComponentProperties(component, initialValues);
            manager.initializePackage(sampleID, initializationOpts);
          } else if (deploymentMode === 'unpack') {
            component = manager.unpack(pkgDir, initializationOpts);
          } else if (deploymentMode === 'install') {
            component = manager.install(pkgDir, initializationOpts);
          } else {
            throw new Error(`Invalid deployment mode ${deploymentMode}`);
          }
          validateComponentProperties(component, newValues);
        });
      });
    }
    describe('#unpack()', function() {
      function validatePackageUnpacking(id, validationCb) {
        if (!validationCb) throw new Error('You must provide a callback to perform validations');
        const pkgDir = copySamplePackage(id);
        const component = manager.unpack(pkgDir);
        validationCb(component);
      }
      it('Unpacks a sample package', function() {
        // Ensure is an empty manager
        expect(_.keys(manager.listPackages())).to.be.an('array').and.to.have.length(0);
        validatePackageUnpacking('demo_package', function(component) {
          expect(_.keys(manager.listPackages())).to.be.an('array').and.to.have.length(1);
          expect(component.lifecycle).to.be.eql('unpacked');
        });
      });
      // Required parameters does not make sense if we are not doing the post installation
      it('Does not throw when required parameters are not provided', function() {
        const pkgDir = samplePackageFromScratch({
          id: 'required_pass', properties: {password: {type: 'password', required: true}}
        });
        expect(function() {
          manager.unpack(pkgDir);
        }).to.not.throw();
      });

      createArgumentParsingTests('unpack');
      it('Executes all the unpack hooks', function() {
        // Ensure is an empty manager
        expect(_.keys(manager.listPackages())).to.be.an('array').and.to.have.length(0);
        validatePackageUnpacking('demo_package', function(component) {
          expect(path.join(component.installdir, 'steps.txt')).to.have.content(unpackSteps.join('\n'));
        });
      });
    });
    describe('#initializePackage()', function() {
      let component = null;
      let sampleID = null;
      beforeEach(function() {
        sampleID = 'demo_package';
        const pkgDir = copySamplePackage(sampleID);
        manager.unpack(pkgDir);
        component = manager.findByID(sampleID);
        expect(component.lifecycle).to.be.eql('unpacked');
      });
      it('Initializes a previously unpacked package', function() {
        manager.initializePackage(sampleID);
        expect(component.lifecycle).to.be.eql('installed');
      });
      createArgumentParsingTests('initialize');

      _.each(['raw', 'hash'], function(argsMode) {
        it(`Throws when required parameters are not provided (${argsMode} mode)`, function() {
          const pkgDir = samplePackageFromScratch({
            id: 'required_pass', properties: {password: {type: 'password', required: true}}
          });
          const password = 'foo';
          component = null;
          expect(function() {
            component = manager.unpack(pkgDir);
          }).to.not.throw();
          expect(component.lifecycle).to.be.eql('unpacked');
          expect(function() {
            manager.initializePackage(component.id);
          }).to.throw('The following options are required: password');
          expect(function() {
            const initializationOpts = argsMode === 'raw' ? {args: [`--password=${password}`]} : {
              hashArgs: {password: password}
            };
            manager.initializePackage(component.id, initializationOpts);
          }).to.not.throw();
        });
      });

      it('Executes only postInstallation hooks', function() {
        const stepsSummary = path.join(component.installdir, 'steps.txt');
        expect(stepsSummary).to.have.content(unpackSteps.join('\n'));
        fs.removeSync(stepsSummary);
        manager.initializePackage(sampleID);
        expect(component.lifecycle).to.be.eql('installed');
        expect(stepsSummary).to.have.content(postInstallSteps.join('\n'));
      });
      it('Throws if the package is already installed unless forced', function() {
        const stepsSummary = path.join(component.installdir, 'steps.txt');
        manager.initializePackage(sampleID);
        expect(component.lifecycle).to.be.eql('installed');
        expect(function() {
          manager.initializePackage(sampleID);
        }).to.throw(`Package ${sampleID} seems to be already fully installed`);
        fs.removeSync(stepsSummary);
        expect(stepsSummary).to.not.be.a.path();
        manager.initializePackage(sampleID, {force: true});
        expect(stepsSummary).to.have.content(postInstallSteps.join('\n'));
        expect(component.lifecycle).to.be.eql('installed');
      });
    });
    describe('#install()', function() {
      it('Installs a sample package', function() {
        const sampleID = 'demo_package';
        // Ensure is an empty manager
        expect(_.keys(manager.listPackages())).to.be.an('array').and.to.have.length(0);
        const component = installSamplePackage(sampleID);
        expect(_.pluck(manager.listPackages(), 'id')).to.be.an('array').and.to.eql([sampleID]);
        const files = ['bin', 'bin/hp-build', 'bin/hp-compress', 'docs', 'docs/chapters', 'docs/chapters/2.txt',
                       'docs/chapters/3.txt', 'docs/chapters/1.txt', 'docs/index.txt'];
        _.each(files, function(p) {
          expect(path.join(component.installdir, p)).to.be.a.path();
        });
      });
      createArgumentParsingTests('install');
      it('Refuses to install a package already installed unless forced', function() {
        const sampleID = 'demo_package';
        const pkgDir = copySamplePackage(sampleID);
        manager.install(pkgDir);
        expect(function() {
          manager.install(pkgDir);
        }).to.throw(/Package demo_package seems to be already installed/);
        expect(function() {
          manager.install(pkgDir, {force: true});
        }).to.not.throw();
      });
      _.each(['raw', 'hash'], function(argsMode) {
        it(`Throws when required parameters are not provided (${argsMode} mode)`, function() {
          const pkgDir = samplePackageFromScratch({
            id: 'required_pass', properties: {password: {type: 'password', required: true}}
          });
          let component = null;
          const password = 'foo';
          expect(function() {
            manager.install(pkgDir);
          }).to.throw('The following options are required: password');
          const initializationOpts = argsMode === 'raw' ? {args: ['--password=foo']} : {hashArgs: {password: 'foo'}};

          expect(function() {
            component = manager.install(pkgDir, initializationOpts);
          }).to.not.throw();
          expect(component.password).to.be.eql(password);
        });
      });
      _.each({
        'Executes all the installation hooks': function(component) {
          expect(path.join(component.installdir, 'steps.txt')).to.have.content(allInstallSteps.join('\n'));
        },
        'Built-in hooks are also available': function(component) {
          expect(function() {
            _.each(allInstallSteps, step => component.builtin[step]());
          }).to.not.throw();
        }
      }, function(validation, title) {
        it(title, function() {
          const sampleID = 'demo_package';
          // Ensure is an empty manager
          expect(_.keys(manager.listPackages())).to.be.an('array').and.to.have.length(0);
          const component = installSamplePackage(sampleID);
          validation(component);
        });
      });
      describe('Package Dependencies', function() {
        let dependencyPkgDir = null;
        let mainPkgDir = null;
        const dependencyProperties = {key: {}};
        // Hardcoding the list will likely make the test fail
        // everytime we add an element, but this way we have better
        // control of the contract exposed
        const builtInKeys = [
          'exports',
          'name',
          'id',
          'version',
          'revision',
          'licenses',
          'installdir',
          'dataDir',
          'logsDir',
          'tmpDir',
          'confDir',
          'libDir',
          'binDir',
        ];
        const allKeys = builtInKeys.concat(_.keys(dependencyProperties)).sort();
        beforeEach(function() {
          dependencyPkgDir = samplePackageFromScratch({
            id: 'com.bitnami.dependency_package', name: 'dependency_package', properties: dependencyProperties
          });
          mainPkgDir = samplePackageFromScratch({
            id: 'main_package', expects: ['com.bitnami.dependency_package'],
            mainJS: `
$app.postInstallation = function() {
  var dependency_package = $modules['com.bitnami.dependency_package'];
  $file.write('dependency.txt', 'name=' + dependency_package.name + '\\nid=' + dependency_package.id);
 };`
          });
        });
        it('Packages can expect other packages', function() {
          manager.install(dependencyPkgDir, {hashArgs: {key: 'some_value'}});
          const mainComponent = manager.install(mainPkgDir);
          expect(path.join(mainComponent.installdir, 'dependency.txt'))
            .to.have.content('name=dependency_package\nid=com.bitnami.dependency_package');
        });
        it('Expected packages are only exposed through a restrictive API', function() {
          const dependency = manager.install(dependencyPkgDir, {hashArgs: {key: 'some_value'}});
          const mainComponent = manager.install(mainPkgDir);
          expect(mainComponent.evalCode(`
Object.keys($modules['com.bitnami.dependency_package']).sort()
`)).to.be.eql(allKeys);

          _.each(allKeys, k => {
            expect(mainComponent.evalCode(
              `$modules['com.bitnami.dependency_package']['${k}']`
            )).to.be.eql(dependency[k]);
            expect(() => mainComponent.evalCode(
              `$modules['com.bitnami.dependency_package']['${k}'] = 'dummyValue'`
            )).to.throw(`'${k}' is read-only`);
          });
        });
      });
    });
  });
  describe('Serialization of properties', function() {
    const samplePkgProperties = {
      password: {type: 'password', required: true},
      plain_attr: {value: 'sample_text'},
      non_serialized: {value: 'non_serializable_data', serializable: false}
    };

    // We internally encrypt/decrypt in this format
    // function encrypt(text, password) {
    //   const cipher = crypto.createCipher('aes-256-gcm', password);
    //   let encrypted = cipher.update(text, 'utf8', 'hex');
    //   encrypted += cipher.final('hex');
    //   const tag = cipher.getAuthTag();
    //   return new Buffer(JSON.stringify({
    //     content: encrypted,
    //     tag: tag.toString('Base64')
    //   })).toString('Base64');
    // }
    function decrypt(data, password) {
      const encrypted = JSON.parse(new Buffer(data, 'Base64').toString());
      const decipher = crypto.createDecipher('aes-256-gcm', password);
      decipher.setAuthTag(new Buffer(encrypted.tag, 'Base64'));
      let decrypted = decipher.update(encrypted.content, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    function validateSerialization(managerObj, pkgProperties, values, validationCb) {
      const defaultValues = _.transform(pkgProperties, function(result, data, key) {
        const value = _.has(data, 'value') ? data.value : '';
        const defaultValue = _.has(data, 'default') ? data.default : '';
        result[key] = value !== '' ? value : defaultValue;
      });
      const pkgDir = samplePackageFromScratch({
        id: 'serialization_test', properties: pkgProperties
      });
      const object = managerObj.install(pkgDir, {hashArgs: values});
      validationCb(object, defaultValues);
    }
    it('By default, do not serializes passwords, parameters' +
       'marked as serializable===false and marked to encrypt but not encrypted', function() {
      manager = getNewManager();
      const values = {
        password: 'a_strong_password', plain_attr: 'insecure plain text',
        non_serialized: 'more_not_serializable_data'
      };
      validateSerialization(manager, samplePkgProperties, values, function(object, defaultValues) {
        // In memory version still preserves all information
        expect(object).to.containSubset(values);
        const newManager = getNewManager({registryPrefix: manager.registryPrefix});
        const reloadedObject = newManager.findByID(object.id);
        expect(reloadedObject).to.have.property('plain_attr', values.plain_attr);
        // Not serializable parameters preserve default values
        expect(reloadedObject).to.containSubset(_.pick(defaultValues, ['password', 'non_serialized']));
      });
    });
    it('Allows forcing serializing non-serializable parameter' +
       'by modifying setting its serializable attribute to true', function() {
      manager = getNewManager();
      const values = {
        password: 'a_strong_password', non_serialized: 'more_not_serializable_data'
      };
      const newSampleProperties = _.transform(
        _.pick(samplePkgProperties, ['password', 'non_serialized']), function(result, data, key) {
          result[key] = _.extend(_.clone(data), {serializable: true});
        }
      );
      validateSerialization(manager, newSampleProperties, values, function(object) {
        // In memory version still preserves all information
        expect(object).to.containSubset(values);
        const reloadedObject = getNewManager({registryPrefix: manager.registryPrefix}).findByID(object.id);
        expect(reloadedObject).to.containSubset(values);
      });
    });
    it('Supports encrypting properties', function() {
      const newSampleProperties = _.extend(
        _.cloneDeep(samplePkgProperties),
        {encrypted_attr: {value: 'text_to_encrypt', encrypt: true}}
      );
      const password = 'b1tnam!';
      const dataToEncrypt = 'important information';
      const values = {
        password: 'a_strong_password', encrypted_attr: dataToEncrypt, non_serialized: 'more_not_serializable_data'
      };
      manager = getNewManager({encryptionPassword: password});
      validateSerialization(manager, newSampleProperties, values, function(object, defaultValues) {
        // In memory version still preserves all information
        expect(object).to.containSubset(values);

        // Dirty way of making sure the data was really encrypted
        const rawRegistryData = manager._registry.getPackages();
        const pkgData = rawRegistryData.serialization_test;
        const encryptedData = pkgData.values.encrypted_attr;
        expect(JSON.parse(decrypt(encryptedData, password))).to.be.eql(dataToEncrypt);

        // We first load without password
        let reloadedObject = getNewManager({registryPrefix: manager.registryPrefix}).findByID(object.id);
        expect(reloadedObject).to.containSubset(_.omit(defaultValues, ['encrypted_attr']));

        // The object should however return null for a non-desencrypted value
        expect(reloadedObject).to.have.property('encrypted_attr').and.eql(null);

        // Reloading with pass
        reloadedObject = getNewManager({registryPrefix: manager.registryPrefix, encryptionPassword: password})
          .findByID(object.id);
        expect(reloadedObject).to.have.property('encrypted_attr').and.eql(dataToEncrypt);
      });
    });
    it('Returns null for non-decrypted encrypted values', function() {
      const password = 'b1tnam!';
      const dataToEncrypt = 'important information';
      manager = getNewManager({encryptionPassword: password});
      validateSerialization(
        manager,
        {encrypted_attr: {value: 'text_to_encrypt', encrypt: true}},
        {encrypted_attr: dataToEncrypt}, function(object) {
          const reloadedObject = getNewManager({registryPrefix: manager.registryPrefix}).findByID(object.id);
          expect(reloadedObject).to.have.property('encrypted_attr').and.to.equal(null);
        }
      );
    });
  });
  describe('#uninstall()', function() {
    it('Uninstalls a package', function() {
      const sampleID = 'demo_package';
      // Ensure is an empty manager
      expect(_.keys(manager.listPackages())).to.be.an('array').and.to.have.length(0);
      const component = installSamplePackage(sampleID);
      expect(_.pluck(manager.listPackages(), 'id')).to.be.an('array').and.to.eql([sampleID]);
      const files = ['bin', 'bin/hp-build', 'bin/hp-compress', 'docs', 'docs/chapters', 'docs/chapters/2.txt',
                     'docs/chapters/3.txt', 'docs/chapters/1.txt', 'docs/index.txt'];
      _.each(files, function(p) {
        expect(path.join(component.installdir, p)).to.be.a.path();
      });
      manager.reload();
      manager.uninstall('demo_package');
      expect(_.keys(manager.listPackages())).to.be.an('array').and.to.have.length(0);
      _.each(files, function(p) {
        expect(path.join(component.installdir, p)).to.not.be.a.path();
      });
    });
    it('Properly report uninstall errors', function() {
      const pkgDir = samplePackageFromScratch({
        id: 'failing_package',
        mainJS: '$app.preUninstallation = function() { throw new Error(\'Sample uninstall error\')};'
      });
      manager.install(pkgDir);
      manager.reload();
      expect(function() {
        manager.uninstall('failing_package');
      }).to.throw('Error executing \'preUninstallation\': Sample uninstall error');
    });
    it('Does not uregisters packages that fail to uninstall', function() {
      const sampleID = 'failing_package';
      const pkgDir = samplePackageFromScratch({
        id: sampleID,
        mainJS: '$app.preUninstallation = function() { throw new Error(\'Sample uninstall error\')};'
      });
      expect(_.pluck(manager.listPackages(), 'id')).to.be.an('array').and.to.eql([]);
      manager.install(pkgDir);
      manager.reload();
      expect(_.pluck(manager.listPackages(), 'id')).to.be.an('array').and.to.eql([sampleID]);
      expect(function() {
        manager.uninstall(sampleID);
      }).to.throw();
      expect(_.pluck(manager.listPackages(), 'id')).to.be.an('array').and.to.eql([sampleID]);
    });
    it('Only can uninstall packages installed as root when running as root', function() {
      const unprivilegedUninstallError = 'This package was installed as root. Refusing' +
              ' to uninstall without admin privileges';
      manager = getNewManager({sampleRegistry: 'minimal'});
      expect(manager.findByID('C').installedAsRoot).to.be.eql(true);
      const expected = expect(function() {
        manager.uninstall('C');
      });
      if (process.getuid() !== 0) {
        expected.to.throw(unprivilegedUninstallError);
      } else {
        expected.to.not.throw(unprivilegedUninstallError);
      }
    });
  });
});
