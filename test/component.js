'use strict';
const chai = require('chai');
const chaiFs = require('chai-fs');
const chaiSubset = require('chai-subset');
const expect = chai.expect;
const intercept = require('intercept-stdout');
const fs = require('fs-extra');
const _ = require('lodash');
const path = require('path');
const testHelpers = require('./helpers.js');
const samplePackageFromScratch = testHelpers.samplePackageFromScratch;
const installPackageFromScratch = testHelpers.installPackageFromScratch;
const getNewManager = testHelpers.getNewManager;
const execSync = require('child_process').execSync;
const Sandbox = require('nami-test').Sandbox;
const Component = require('../lib/components/component');
const Service = require('../lib/components/service');
const types = {Service: Service, Component: Component};

chai.use(chaiSubset);
chai.use(chaiFs);

describe('Components', function() {
  let manager = null;
  let sb = null;
  beforeEach(function() {
    sb = new Sandbox();
    manager = getNewManager();
  });
  afterEach(function() {
    sb.cleanup();
  });
  after(function() {
    testHelpers.cleanUpTemporaryFiles();
  });
  const samplePkgSpec = {id: 'com.bitnami.sample', name: 'sample', version: '1.2.3', revision: '0'};
  const sampleServicePkgSpec = _.extend(_.clone(samplePkgSpec), {
    extends: ['Service'],
    service: {
      pidFile: '{{$app.tmpDir}}/sample.pid',
      logFile: '{{$app.logsDir}}/access.log',
      socketFile: '{{$app.tmpDir}}/sample.sock',
      confFile: '{{$app.confDir}}/sample.conf',
      start: {
        timeout: 10,
        username: 'root',
        command: '{{$app.installdir}}/sbin/daemon'
      }
    }
  });
  const sampleManifest = {
    dir1: {
      'sample.txt': '',
      'file2': 'data',
      'link': ['target']
    },
    dir2: {
      'file2.png': 'pretty_image',
      dir21: {
        'file21.txt': 'Sample file 1',
        '.hiddenFile': 'secret info'
      },
      emptydir: {
      }
    }
  };
  const customComponentPackaging = [{
    name: 'default', folders: [{
      name: 'defaultFolder', files: [{origin: ['files/dir2/file*', 'files/dir2/dir21', 'files/dir2/emptydir']}]
    }]
  }];

  const samplePackagingData = {
    packaging: {
      components: [{
        name: 'default', folders: [{
          name: 'defaultFolder', files: [{origin: ['files/*']}]
        }]
      }]
    }
  };
  const multiComponentsPackingData = {
    packaging: {
      components: [{
        name: 'component1', folders: [{
          name: 'folder1', files: [{origin: ['files/dir1']}]
        }]
      }, {
        name: 'component2', folders: [{
          name: 'folder2', files: [{origin: ['files/dir2']}]
        }]
      }]
    }
  };
  // Perform modifications over object without mutating it
  function setData(data) {
    const newData = _.cloneDeep(data);
    let overwrites = null;
    if (_.isString(arguments[1])) {
      const attr = arguments[1];
      const value = arguments[2];
      overwrites = {};
      overwrites[attr] = value;
    } else {
      overwrites = arguments[1];
    }
    _.each(overwrites, function(value, key) {
      _.set(newData, key, value);
    });
    return newData;
  }
  function getSamplePackageDefinition(installationData) {
    return {
      id: 'com.bitnami.packaging', name: 'packaging',
      filesManifest: sampleManifest, raw: {installation: installationData}
    };
  }
  function samplePkgFromInstallData(installationData) {
    const uniqueId = process.hrtime().join('');
    return samplePackageFromScratch({
      id: `com.bitnami.packaging${uniqueId}`, name: `packaging${uniqueId}`, filesManifest: sampleManifest,
      raw: {installation: installationData}
    });
    // getSamplePackageDefinition(packagingData));
  }
  function createPackAttributesTests(testsData, packagingData) {
    packagingData = packagingData || samplePackagingData;
    _.each(testsData, function(data, key) {
      _.each({
        'component': 'packaging.components[0]',
        folder: 'packaging.components[0].folders[0]'
      }, function(element, level) {
        const attrPath = `${element}.${key}`;
        const value = data.value;
        const validation = data.test;
        const title = data.title || `Properly handles the ${key} key`;
        it(`${title} at ${level} level`, function() {
          const pkgDir = samplePackageFromScratch(getSamplePackageDefinition(setData(packagingData, attrPath, value)));
          const obj = manager.install(pkgDir);
          validation(pkgDir, obj, value);
        });
      });
    });
  }
  describe('#installation', function() {
    let prefixDir = null;
    let pkgDir = null;
    const id = 'demo_package';
    let obj = null;
    let reloadedObj = null;
    beforeEach(function() {
      prefixDir = testHelpers.getTemporaryFile('new_root_dir');
      fs.mkdirpSync(prefixDir);
      pkgDir = samplePackageFromScratch({id: id, name: id});
      obj = manager.install(pkgDir, {installPrefix: prefixDir});
      reloadedObj = manager.search(id, {requestSingleResult: true, reload: true});
    });
    describe('#installation.root', function() {
      it('Is set to the parent install dir', function() {
        expect(obj.installation.root).to.be.eql(prefixDir);
        expect(reloadedObj.installation.root).to.be.eql(prefixDir);
      });
    });
  });
  describe('#installPrefix', function() {
    let prefixDir = null;
    let pkgDir = null;
    const id = 'demo_package';
    let obj = null;
    let reloadedObj = null;
    beforeEach(function() {
      prefixDir = testHelpers.getTemporaryFile('new_root_dir');
      fs.mkdirpSync(prefixDir);
      pkgDir = samplePackageFromScratch({id: id, name: id});
      obj = manager.install(pkgDir, {installPrefix: prefixDir});
      reloadedObj = manager.search(id, {requestSingleResult: true, reload: true});
    });
    it('Retrieves the installation.root', function() {
      _.each(['installation.root', 'installPrefix'], function(attr) {
        expect(_.get(obj, attr)).to.be.eql(prefixDir);
        expect(_.get(reloadedObj, attr)).to.be.eql(prefixDir);
      });
    });
    it('Sets the installation.root', function() {
      obj.installPrefix = '/tmp';
      expect(obj.installation.root).to.be.eql('/tmp');
    });
  });
  describe('#lifecycle', function() {
    it('Defaults to null', function() {
      const obj = new Component(samplePkgSpec);
      expect(obj.lifecycle).to.be.eql(null);
    });
    it('Is set to installed after a successfull installation', function() {
      const pkgDir = samplePackageFromScratch(samplePkgSpec);
      const obj = manager.install(pkgDir);
      expect(obj.lifecycle).to.be.eql('installed');
    });
    it('It contains the state at the last successful step executed', function() {
      const id = 'com.bitnami.failedPackage';
      const id2 = 'com.bitnami.successfulPackage';
      const pkgDir1 = samplePackageFromScratch({
        id: id,
        mainJS: `$app.postInstallation = function() { throw new Error('something went wrong'); }`
      });
      const pkgDir2 = samplePackageFromScratch({id: id2});
      expect(function() {
        manager.install(pkgDir1);
      }).to.throw();
      // A failed installation does not return the obj
      const obj1 = manager.search(id, {requestSingleResult: true, reload: true});
      const obj2 = manager.install(pkgDir2);
      expect(obj1.lifecycle).to.be.eql('unpacked');
      expect(obj2.lifecycle).to.be.eql('installed');
    });
  });
  describe('#installdir', function() {
    it('Defaults to /opt/bitnami/package.name', function() {
      _.each({
        Component: samplePkgSpec, Service: sampleServicePkgSpec
      }, function(spec, type) {
        const Class = types[type];
        const obj = new Class(spec);
        expect(obj.installdir).to.be.eql(`/opt/bitnami/${spec.name}`);
      });
    });
    it('The installation root can be configured through the "installPrefix" option', function() {
      const obj = new Component(samplePkgSpec, {installPrefix: '/tmp/new_root'});
      expect(obj.installdir).to.be.eql(`/tmp/new_root/${samplePkgSpec.name}`);
    });
    it('The installation root can be configured through the "installdir" option', function() {
      const installdir = '/tmp/new_root';
      const obj = new Component(samplePkgSpec, {installdir: installdir});
      expect(obj.installdir).to.be.eql(installdir);
    });
    it('It can be enforced while installing', function() {
      const prefixDir = testHelpers.getTemporaryFile('new_install_dir');
      fs.mkdirpSync(prefixDir);
      const pkgDir = samplePackageFromScratch(samplePkgSpec);
      const obj = manager.install(pkgDir, {installPrefix: prefixDir});
      const expectedInstalldir = path.join(prefixDir, samplePkgSpec.name);
      expect(obj.installdir).to.be.eql(expectedInstalldir);
      expect(manager.search(samplePkgSpec.id, {
        requestSingleResult: true, reload: true
      }).installdir).to.be.eql(expectedInstalldir);
    });
    it('It is reloaded from serialized data after installing', function() {
      const newManager = getNewManager({sampleRegistry: 'minimal'});
      expect(newManager.search('B', {requestSingleResult: true, reload: true}).installdir)
        .to.be.eql('/opt/bitnami/bar');
    });
  });
  describe('Dynamic properties', function() {
    let obj = null;
    function createPropertiesAttributeTests(definitionFunction) {
      it('Allows defining read-only dynamic properties', function() {
        const value = 'sample_data';
        let expected = null;
        if (definitionFunction === 'defineDynamicProperty') {
          expected = value;
        } else {
          expected = path.join(obj.installdir, value);
        }
        obj[definitionFunction]('readOnlyAttr', {initialValue: value, writable: false});
        expect(obj.readOnlyAttr).to.be.eql(expected);
        expect(function() {
          obj.readOnlyAttr = 'other_value';
        }).to.throw(/'readOnlyAttr' is read-only/);
      });
      it('By default, creates enumerable properties', function() {
        obj[definitionFunction]('demoProp');
        expect(obj.propertyIsEnumerable('demoProp')).to.be.eql(true);
      });
      it('Allows marking properties as non-enumerable', function() {
        obj[definitionFunction]('demoProp', {enumerable: false});
        expect(obj.propertyIsEnumerable('demoProp')).to.be.eql(false);
      });
      it('By default, marks underscored properties as non-enumerable', function() {
        obj[definitionFunction]('_demoProp');
        expect(obj.propertyIsEnumerable('_demoProp')).to.be.eql(false);
      });
      it('Allows forcing underscored properties to be enumerable', function() {
        obj[definitionFunction]('_demoProp', {enumerable: true});
        expect(obj.propertyIsEnumerable('_demoProp')).to.be.eql(true);
      });
    }

    describe('Built-in Dynamic properties', function() {
      const commonAttrValues = {logsDir: 'logs', confDir: 'conf', dataDir: 'data', tmpDir: 'tmp'};
      const servicesAttrs = _.extend(
        _.clone(commonAttrValues),
        {
          pidFile: 'tmp/sample.pid',
          logFile: 'logs/access.log',
          socketFile: 'tmp/sample.sock',
          confFile: 'conf/sample.conf'
        }
      );
      _.each({
        'Defines common path attribues': {
          attrs: commonAttrValues,
          spec: samplePkgSpec
        },
        'Defines services built-in attributes': {
          attrs: servicesAttrs,
          spec: sampleServicePkgSpec
        }
      }, function(testSpec, title) {
        it(title, function() {
          const prefixDir = testHelpers.getTemporaryFile('new_install_dir');
          fs.mkdirpSync(prefixDir);
          const pkgSpec = testSpec.spec;
          const attrData = testSpec.attrs;
          const pkgDir = samplePackageFromScratch(pkgSpec);
          const testObj = manager.install(pkgDir, {installPrefix: prefixDir});
          const reloadedObj = manager.search(pkgSpec.id, {requestSingleResult: true, reload: true});
          _.each(attrData, function(value, attr) {
            const expectedValue = path.join(prefixDir, samplePkgSpec.name, value);
            expect(testObj[attr]).to.be.eql(expectedValue);
            expect(reloadedObj[attr]).to.be.eql(expectedValue);
          });
        });
      });
    });
    describe('#defineDynamicProperty()', function() {
      beforeEach(function() {
        obj = new Component(samplePkgSpec);
      });
      it('Allows defining simple dynamic properties', function() {
        obj.defineDynamicProperty('foo', {initialValue: 'bar'});
        obj.defineDynamicProperty('shoutedName', {initialValue: '{{$app.name}}!'});

        expect(obj.foo).to.be.eql('bar');
        obj.foo = 'new_value';
        expect(obj.foo).to.be.eql('new_value');

        expect(obj.shoutedName).to.be.eql(`${obj.name}!`);
        obj.shoutedName = 'I said {{$app.name}}!';
        expect(obj.shoutedName).to.be.eql(`I said ${obj.name}!`);
      });
      createPropertiesAttributeTests('defineDynamicProperty');
      it('Supports property getters', function() {
        let value = 'demo';
        obj.defineDynamicProperty('uppercaseWord', {initialValue: value, getter: val => val.toUpperCase(val)});
        expect(obj.uppercaseWord).to.be.eql(value.toUpperCase());

        value = 'other_value';
        obj.uppercaseWord = value;
        expect(obj.uppercaseWord).to.be.eql(value.toUpperCase());
      });
      it('Supports property setters', function() {
        obj.defineDynamicProperty('maxNumber', {
          initialValue: 0,
          setter: (newValue, currentValue) => {
            return newValue > currentValue ? newValue : currentValue;
          }
        });
        expect(obj.maxNumber).to.be.eql(0);

        obj.maxNumber = 12;
        expect(obj.maxNumber).to.be.eql(12);

        obj.maxNumber = 5;
        expect(obj.maxNumber).to.be.eql(12);

        obj.maxNumber = 13;
        expect(obj.maxNumber).to.be.eql(13);
      });
      it('Allows creating composite properties', function() {
        obj.defineDynamicProperty('customFullVersion', {
          getter: function() {
            return `${this.version}-${this.revision}`;
          }
        });
        expect(obj.customFullVersion).to.be.eql(`${obj.version}-${obj.revision}`);
      });
    });
    describe('#defineDynamicPathProperty()', function() {
      beforeEach(function() {
        obj = new Component(samplePkgSpec);
        obj.initialize();
      });
      it('Allows defining simple dynamic path properties', function() {
        obj.defineDynamicPathProperty('documentationDir', {initialValue: 'docs'});
        expect(obj.documentationDir).to.be.eql(path.join(obj.installdir, 'docs'));

        obj.documentationDir = '/tmp/docs';
        expect(obj.documentationDir).to.be.eql('/tmp/docs');

        obj.documentationDir = 'extra-docs';
        expect(obj.documentationDir).to.be.eql(path.join(obj.installdir, 'extra-docs'));
      });
      createPropertiesAttributeTests('defineDynamicPathProperty');
    });
  });
  describe('#subst()', function() {
    let obj = null;
    beforeEach(function() {
      obj = new Component(samplePkgSpec);
      obj.initialize();
    });
    it('Resolves handlebar templates with information available from the component', function() {
      expect(obj.subst('{{$app.name}} has version {{$app.version}}-{{$app.id}}'))
        .to.be.eql(`${obj.name} has version ${obj.version}-${obj.id}`);
    });
    it('Allows providing extra information when resolving the templates', function() {
      expect(obj.subst('{{$app.name}} - {{foo}}')).to.be.eql(`${obj.name} - `);
      expect(obj.subst('{{$app.name}} - {{foo}}', {foo: 'bar'})).to.be.eql(`${obj.name} - bar`);
    });
    it('Does not try to resolve non-string elements', function() {
      _.each([24, Infinity, ['a', 'b'], {foo: 'bar'}, null, undefined, function a() {}], function(element) {
        expect(obj.subst(element)).to.be.eql(element);
      });
    });
  });
  describe('#installedAsRoot', function() {
    it('Defaults to the current process user before installation', function() {
      const currentUserIsRoot = process.getuid() === 0;
      const obj = new Component(samplePkgSpec);
      expect(obj.installedAsRoot).to.be.eql(currentUserIsRoot);
    });
    it('It is reloaded from serialized data after installing', function() {
      const newManager = getNewManager({sampleRegistry: 'minimal'});
      expect(newManager.search('B', {requestSingleResult: true, reload: true}).installedAsRoot).to.be.eql(false);
      expect(newManager.search('C', {requestSingleResult: true, reload: true}).installedAsRoot).to.be.eql(true);
    });
  });
  _.each({
    'Has access to its JS files after installation': function(obj) {
      expect(obj.exports.test()).to.be.eql(true);
      expect(obj.exports.toUpper('hello')).to.be.eql('HELLO');
      expect(obj.exports.toUpper('hello', {shout: true})).to.be.eql('HELLO!');
    },
    'Has access to its template files after installation': function(obj) {
      expect(obj.evalCode(`$hb.render('sample.tpl')`)).to.be.eql(obj.id);
    }
  }, function(validation, title) {
    it(title, function() {
      this.timeout(5000);
      const id = 'com.bitnami.samplePackage';
      const pkgDir = samplePackageFromScratch({
        id: id, exports: {
          test: {},
          toUpper: {
            arguments: ['name'],
            options: {
              shout: false
            }
          }
        },
        mainJS: `
$app.exports.test = function() { return true };
$app.exports.toUpper = function(name, options) {
options = options || {shout: false};
const text = name.toUpperCase();
return options.shout ? text + '!' : text;
}
`,
        templates: {'sample.tpl': '{{$app.id}}'}
      });
      const obj1 = manager.install(pkgDir);
      // We want to reload the object
      const obj2 = manager.search(id, {requestSingleResult: true, reload: true});
      // Ensure they are different
      expect(obj1).to.not.be.eql(obj2);
      validation(obj2);
    });
  });
  describe('Service', function() {
    this.timeout(5000);
    describe('Built-in methods', function() {
      let component = null;
      function getPid() {
        return parseInt(fs.readFileSync(component.pidFile).toString().trim(), 10);
      }
      function _callCommand(cmd) {
        return execSync(
          `${component.installdir}/ctlscript.sh ${cmd} > /dev/null 2> /dev/null`,
          {detached: true}
        ).toString().trim();
      }
      function start() {
        return _callCommand('start');
      }
      function stop() {
        return _callCommand('stop');
      }
      function cleanUp() {
        stop();
        // Make sure it is stopped
        try {
          process.kill(getPid());
        } catch (e) { /* not empty */ }
        _.each(['tmp/service.pid', 'logs/service.log'], function(f) {
          fs.removeSync(path.join(component.installdir, f));
        });
      }
      // function status() {
      //   return _callCommand('status');
      // }

      before(function() {
        component = testHelpers.installSamplePackage('sample-service', {manager: manager});
      });
      beforeEach(function() {
        cleanUp();
      });

      afterEach(function() {
        cleanUp();
      });
      describe('#log()', function() {
        it('Retrieves the last lines of the log', function() {
          component.start();
          let capturedText = '';
          const unhookIntercept = intercept(function(txt) {
            capturedText += txt;
            return '';
          });
          let logText = null;
          try {
            logText = component.log();
          } finally {
            unhookIntercept();
          }
          _.each([logText, capturedText], function(str) {
            expect(str).to.contain('[START] STARTING SERVICE');
          });
        });
      });

      describe('#getPid()', function() {
        it('Returns the pid of the service', function() {
          component.start();
          expect(component.getPid()).to.be.eql(getPid());
        });
        it('Returns null if the service is not running', function() {
          expect(component.getPid()).to.be.eql(null);
        });
      });
      describe('#start()', function() {
        it('Supports starting the service', function() {
          fs.removeSync(component.pidFile);
          expect(component.pidFile).to.not.be.a.path();
          component.start();
          expect(component.pidFile).to.be.a.file();
          expect(process.kill(getPid(), 0)).to.be.eql(true);
        });
      });
      describe('#stop()', function() {
        it('Supports stoping the service', function() {
          start();
          expect(component.pidFile).to.be.a.file();
          const pid = getPid();
          expect(process.kill(pid, 0)).to.be.eql(true);
          component.stop();
          // expect(component.pidFile).to.not.be.a.path();
          expect(function() {
            process.kill(pid, 0);
          }).to.throw(/kill ESRCH/);
        });
      });
      describe('#restart()', function() {
        it('Supports restarting a running service', function() {
          start();
          expect(component.pidFile).to.be.a.file();
          const pid = getPid();
          expect(process.kill(pid, 0)).to.be.eql(true);
          component.restart();
          // Is still running but changed pid
          expect(function() {
            process.kill(pid, 0);
          }).to.throw(/kill ESRCH/);

          const newPid = getPid();
          expect(process.kill(newPid, 0)).to.be.eql(true);
          expect(pid).to.not.be.eql(newPid);
        });
      });
      describe('#status()', function() {
        it('Supports returning the status of the service', function() {
          expect(component.pidFile).to.not.be.a.path();

          expect(component.status()).to.be.eql({
            isRunning: false,
            statusName: 'stopped',
            statusOutput: `${component.id} not running`,
            code: 1
          });

          start();

          expect(component.status()).to.be.eql({
            isRunning: true,
            statusName: 'running',
            statusOutput: `${component.id} is running`,
            code: 0
          });
        });
      });
      describe('#isRunning()', function() {
        it('Returns true if running, false otherwise', function() {
          expect(component.isRunning()).to.be.eql(false);
          start();
          expect(component.isRunning()).to.be.eql(true);
        });
      });
    });
    describe('Error handling', function() {
      it('Properly report errors with successfully executed commands but missing pidFile', function() {
        const failingService = setData(sampleServicePkgSpec, 'service.start', {
          command: 'echo It works',
          timeout: 1
        });
        const obj = installPackageFromScratch(failingService);
        expect(function() {
          obj.start();
        }).to.throw(`Unable to start ${obj.id}: Cannot find pid file '${obj.pidFile}'.`);
      });
      it('Properly report errors with successfully executed commands' +
         ' with written pidFile but no process running', function() {
        const failingService = setData(sampleServicePkgSpec, 'service.start', {
          command: 'echo It works',
          timeout: 1
        });
        const obj = installPackageFromScratch(failingService);
        fs.mkdirpSync(path.dirname(obj.pidFile));
        fs.writeFileSync(obj.pidFile, 123456);
        expect(function() {
          obj.start();
        }).to.throw(`Unable to start ${obj.id}: Pid file '${obj.pidFile}'` +
                    ' was found but either no proper PID was found or no process is running there.');
      });
      it('It properly report errors with failing start command', function() {
        const errorMsg = 'Internal server error';
        const failingService = setData(sampleServicePkgSpec, 'service.start', {
          command: `sleep 2 && echo ${errorMsg} >&2 && exit 1`,
          timeout: 3
        });
        const obj = installPackageFromScratch(failingService);
        expect(function() {
          obj.start();
        }).to.throw(`Unable to start ${obj.id}: ${errorMsg}`);
      });
    });
  });
  describe('Packaging', function() {
    // this.installation
    it('Packs files under files/ dir automatically if present and no' +
       ' installation/packaging section is present', function() {
      const pkgDir = samplePackageFromScratch({
        id: 'com.bitnami.packaging1', name: 'packaging1', filesManifest: sampleManifest
      });
      const obj = manager.install(pkgDir);
      expect(testHelpers.diffDirs(path.join(pkgDir, 'files'), obj.installdir)).to.be.eql([]);
    });
    it(`If the 'packaging' section is provided, it does not pack anything by default`, function() {
      const pkgDir = samplePackageFromScratch({
        id: 'com.bitnami.packaging2',
        name: 'packaging1',
        filesManifest: sampleManifest,
        raw: {installation: {packaging: {}}}
      });
      const obj = manager.install(pkgDir);
      expect(testHelpers.listDirRecursively(obj.installdir)).to.be.eql([]);
    });
    it('Allows configuring the destination prefix', function() {
      const prefix = 'test-prefix';
      const pkgDir = samplePkgFromInstallData({prefix: prefix});
      const obj = manager.install(pkgDir);
      const installdir = path.join(obj.installation.root, prefix);
      expect(installdir).to.be.a.path();
      expect(testHelpers.diffDirs(path.join(pkgDir, 'files'), installdir)).to.be.eql([]);
    });
    it('Allows stripping file components', function() {
      const pkgDir = samplePackageFromScratch({
        id: 'com.bitnami.packaging4',
        name: 'packaging1',
        filesManifest: {root: sampleManifest},
        raw: {installation: {strip: 1}}
      });
      const obj = manager.install(pkgDir);
      expect(testHelpers.diffDirs(path.join(pkgDir, 'files/root'), obj.installdir)).to.be.eql([]);
    });
    it('By default, throws in no file matches the packing patterns', function() {
      const data = setData(
        samplePackagingData,
        'packaging.components[0].folders[0].files',
        [{origin: ['not_matching_pattern']}]
      );
      let obj = null;
      let pkgDir = null;
      expect(function() {
        pkgDir = samplePkgFromInstallData(data);
        obj = manager.install(pkgDir);
      }).to.throw(/resolved to an empty list of files/);
      expect(function() {
        pkgDir = samplePkgFromInstallData(
          setData(data, 'packaging.components[0].folders[0].files[0].allowEmptyList', true)
        );
        obj = manager.install(pkgDir);
      }).to.not.throw();
      expect(fs.readdirSync(obj.installdir)).to.be.eql([]);
    });

    it('Allows manually picking files', function() {
      const pkgDir = samplePkgFromInstallData(
        setData(samplePackagingData, 'packaging.components', customComponentPackaging)
      );
      const obj = manager.install(pkgDir);
      expect(testHelpers.diffDirs(path.join(pkgDir, 'files/dir2/'), obj.installdir, {prettify: true})).to.be.eql([]);
    });
    createPackAttributesTests({
      selected: {
        value: false,
        title: 'Do not install deselected elements',
        test: function(pkgDir, obj) {
          expect(fs.readdirSync(obj.installdir)).to.be.eql(['dir2']);
          expect(testHelpers.diffDirs(
            path.join(pkgDir, 'files/dir2'),
            path.join(obj.installdir, 'dir2'),
            {prettify: true}
          )).to.be.eql([]);
        }
      }
    }, multiComponentsPackingData);

    it('Does not pack deselected components', function() {
      const pkgDir = samplePkgFromInstallData(
        setData(multiComponentsPackingData, 'packaging.components[0].selected', false)
      );
      const obj = manager.install(pkgDir);
      expect(fs.readdirSync(obj.installdir)).to.be.eql(['dir2']);
      expect(testHelpers.diffDirs(
        path.join(pkgDir, 'files/dir2'),
        path.join(obj.installdir, 'dir2'),
        {prettify: true}
      )).to.be.eql([]);
    });
    _.each({
      component: 'packaging.components[0].destination',
      folder: 'packaging.components[0].folders[0].destination'
    }, function(attrPath, level) {
      it(`Allows manually setting the destination at ${level} level`, function() {
        const destination = path.join(manager.installationPrefix, 'custom_destination_prefix');
        const pkgDir = samplePkgFromInstallData(setData({
          packaging: {
            components: customComponentPackaging
          }
        }, attrPath, destination));
        manager.install(pkgDir);
        expect(testHelpers.diffDirs(path.join(pkgDir, 'files/dir2/'), destination, {prettify: true})).to.be.eql([]);
      });
    });
    _.each({
      'Supports handlebar references in destination': '{{$app.installdir}}/sub_dir',
      'Supports using relative paths in destination': 'sub_dir'
    }, function(destination, title) {
      it(title, function() {
        const pkgDir = samplePkgFromInstallData(
          setData(samplePackagingData, 'packaging.components[0].destination', '{{$app.installdir}}/sub_dir')
        );
        const obj = manager.install(pkgDir);
        expect(testHelpers.diffDirs(path.join(pkgDir, 'files/'), path.join(obj.installdir, 'sub_dir'))).to.be.eql([]);
      });
    });
    createPackAttributesTests({
      permissions: {
        value: '777',
        test: function(pkgDir, obj, expectedValue) {
          expect(testHelpers.diffDirs(path.join(pkgDir, 'files/'), obj.installdir, {prettify: true})).to.be.eql([]);
          _.each(testHelpers.listDirRecursively(obj.installdir), function(f) {
            const stats = fs.lstatSync(path.join(obj.installdir, f));
            const filePermissions = (stats.mode & parseInt('0777', 8)).toString(8);
            // Symlinks permissions are not modified
            if (stats.isSymbolicLink()) return;
            expect(filePermissions).to.be.eql(expectedValue);
          });
        }
      }
    });
    // It is really hard to convert users to ids without using nami code
    // look for a better way
    // function ensureDirOwnership(dir, owner, group) {
    //   _.each(testHelpers.listDirRecursively(dir), function(f) {
    //     const stats = fs.lstatSync(path.join(dir, f));
    //     const expectedOwnership = testHelpers.mapOwnerAndGroupToIds(owner, group);
    //     // Symlinks permissions are not modified
    //     if (stats.isSymbolicLink()) return;
    //     expect(expectedOwnership).to.be.eql(_.pick(stats, ['uid', 'gid']));
    //   });
    // }
    // if (process.getuid() === 0) {
    //   createPackAttributesTests({
    //     owner: {
    //       value: 'daemon',
    //       test: function(pkgDir, obj, expectedValue) {
    //         ensureDirOwnership(pkgDir, expectedValue, null);
    //       }
    //     }
    //   });
    // }
    describe('File inclusion/exclusion', function() {
      function getSamplePkgDir(filesInfo) {
        return samplePkgFromInstallData(
          setData(samplePackagingData, 'packaging.components[0].folders[0].files[0]', filesInfo)
        );
      }
      it('Allows excluding files', function() {
        const pkgDir = getSamplePkgDir({origin: ['files/*'], exclude: ['*.txt']});
        const obj = manager.install(pkgDir);
        const srcDir = path.join(pkgDir, 'files/');
        expect(testHelpers.diffDirs(srcDir, obj.installdir))
          .to.be.eql(_.filter(testHelpers.listDirRecursively(srcDir), f => f.match(/.*\.txt$/)));
      });
      it('Allows combining include and exclude patterns', function() {
        const pkgDir = getSamplePkgDir({origin: ['files/*'], include: ['*.txt'], exclude: ['*/sample.txt']});
        const obj = manager.install(pkgDir);
        expect(testHelpers.listDirRecursively(obj.installdir))
          .to.be.eql(['dir2', 'dir2/dir21', 'dir2/dir21/file21.txt']);
      });
    });
    describe('Tag Operations', function() {
      describe('SetPermissions', function() {
        _.each({
          component: 'packaging.components[0].tagOperations',
          folder: 'packaging.components[0].folders[0].tagOperations'
        }, function(attr, key) {
          const expectedValue = '777';
          const overwrites = {};
          overwrites['packaging.components[0].folders[0].tags'] = ['executables'];
          overwrites[attr] = {
            executables: [{
              setPermissions: {
                permissions: expectedValue
              }
            }]
          };
          it(`Changes permissions by tags setting tagOperations in ${key} elements`, function() {
            const pkgDir = samplePkgFromInstallData(setData(samplePackagingData, overwrites));
            const obj = manager.install(pkgDir);
            expect(testHelpers.diffDirs(path.join(pkgDir, 'files/'), obj.installdir, {prettify: true})).to.be.eql([]);
            _.each(testHelpers.listDirRecursively(obj.installdir), function(f) {
              const stats = fs.lstatSync(path.join(obj.installdir, f));
              const filePermissions = (stats.mode & parseInt('0777', 8)).toString(8);
              // Symlinks permissions are not modified
              if (stats.isSymbolicLink()) return;
              expect(filePermissions).to.be.eql(expectedValue);
            });
          });
        });
      });
    });
  });
  describe('#getHandler()', function() {
    it('Allows getting a readonly version of a component', function() {
      const exports = {test: {}};
      const properties = {foo: 'bar', demo: true};
      const pkgDir = samplePackageFromScratch(setData(samplePkgSpec, {
        exports: exports,
        properties: properties,
        mainJS: `$app.exports.test = function() { return true };`
      }));
      const obj = manager.install(pkgDir);
      const handler = obj.getHandler();
      // Some well known internal/not exposed keys
      _.each(['_spec', 'metadataDir', 'jsFiles'], function(key) {
        expect(obj[key]).to.not.be.an('undefined');
        expect(handler[key]).to.be.an('undefined');
      });
      // Hardcoding the list will likely make the test fail
      // everytime we add an element, but this way we have better
      // control of the contract exposed
      _.each([
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
      ], function(key) {
        expect(handler[key]).to.be.eql(obj[key]);
        expect(function() {
          handler[key] = 'some_value';
        }).to.throw(`'${key}' is read-only`);
      });
      // JSON defined properties and exports are also exposed
      _.each(properties, function(value, key) {
        expect(handler[key]).to.be.eql(obj[key]);
        expect(handler[key]).to.be.eql(value);
        expect(function() {
          handler[key] = 'some_value';
        }).to.throw(`'${key}' is read-only`);
      });
      _.each(exports, function(value, key) {
        expect(handler.exports[key]).to.be.eql(obj.exports[key]);
        expect(handler[key]()).to.be.eql(obj.exports[key]());
        expect(function() {
          handler[key] = 'some_value';
        }).to.throw(`'${key}' is read-only`);
      });
    });
  });

  describe('#evalCode()', function() {
    it('Executes sample code in the cotext of the component', function() {
      const obj = new Component(samplePkgSpec);
      obj.initialize();
      _.each({
        '$app.name': obj.name,
        '$file.normalize(".")': obj.installdir
      }, function(result, code) {
        expect(obj.evalCode(code)).to.be.eql(result);
      });
    });
  });
  describe('#serialize()', function() {
    it('Saves the component definition to a given directory', function() {
      const pkgDir = samplePackageFromScratch({
        id: 'com.bitnami.samplepkg', properties: {
          password: {type: 'password', required: true},
          backup: {type: 'boolean'},
          'data-dir': {default: 'data'}
        },
        mainJS: `$app.postInstallation = function() { return $app.helpers.demo(); }`,
        helpersJS: `$app.helpers.demo = function() { return 'it works!'; }`
      });
      const templatesDir = path.join(pkgDir, 'templates');
      fs.mkdirSync(templatesDir);
      fs.writeFileSync(path.join(templatesDir, 'demo.tpl'), '{{$app.name}}');

      const filesDir = path.join(pkgDir, 'files');
      fs.mkdirSync(filesDir);
      fs.writeFileSync(path.join(filesDir, 'file.txt'), 'asdfasdf');

      const inputs = {
        password: 'secret',
        backup: true,
        'data-dir': 'persistent-dir'
      };
      const installdir = sb.normalize('/opt/sample-dir');
      const obj = manager.install(pkgDir, {hashArgs: inputs, installPrefix: installdir});
      expect(obj.lifecycle).to.be.eql('installed');

      const definitionDir = sb.normalize('package-definition');
      const res = obj.serialize(definitionDir);

      expect(res.definition.resources).to.be.eql({
        js: ['helpers.js', 'main.js'],
        extra: ['templates'],
        json: 'nami.json',
        installedFiles: 'installed-files.txt'
      });

      const expectedFiles = ['nami.json', 'main.js', 'helpers.js', 'templates', 'installed-files.txt'].sort();
      expect(fs.readdirSync(definitionDir).sort()).to.be.eql(expectedFiles);

      const diff = testHelpers.diffDirs(definitionDir, pkgDir);
      // 'files' should not be saved, and 'installed-files.txt' is the manifest of installed files
      expect(diff.sort()).to.be.eql(['installed-files.txt', 'files', 'files/file.txt'].sort());
    });
    // Not very useful for now, but has potential.
    it('Allows serializing Component objects manually created with new', function() {
      const obj = new Component(samplePkgSpec);
      const definitionDir = sb.normalize('package-definition');
      const res = obj.serialize(definitionDir);
      expect(path.join(definitionDir, 'nami.json')).to.be.a.path();
      expect(res.definition.resources).to.be.eql({
        js: [],
        extra: [],
        json: 'nami.json'
      });
    });
  });
});
