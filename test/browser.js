'use strict';
const chai = require('chai');
const path = require('path');
const chaiSubset = require('chai-subset');
const expect = chai.expect;
const fs = require('fs-extra');
const _ = require('lodash');
const http = require('http');
const url = require('url');
const director = require('director');
const $Browser = require('../lib/browser');
chai.use(chaiSubset);

class MockServer {
  constructor(options) {
    options = _.defaults(options || {}, {timeout: -1, closeCb: null});
    this.timeout = options.timeout;
    this._timeoutObj = null;
    this._port = null;
    this._router = new director.http.Router();
    const router = this._router;
    this._server = http.createServer(function(req, res) {
      // >>>> YOU MUST DO THIS <<<<
      req.chunks = [];
      req.on('data', function(chunk) {
        req.chunks.push(chunk.toString());
      });
      // >>>> YOU MUST DO THIS (END) <<<<
      router.dispatch(req, res, function(err) {
        if (err) {
          res.writeHead(404);
          res.end();
        }
      });
    });
  }
  addRoute(verb, resource, fn) {
    this._router[verb](resource, fn);
  }
  path(p, fn) {
    this._router.path(p, fn);
  }
  get host() {
    return 'localhost';
  }
  absolutize(uri) {
    uri = uri.replace(/^\//, '');
    return `http://${this.host}:${this._port}/${uri}`;
  }
  listen(port) {
    if (!port) {
      port = Math.floor((Math.random() * 10000) + 1024);
    }
    this._port = port;
    if (this.timeout >= 0) {
      this._timeoutObj = setTimeout(() => {
        this.close();
      }, this.timeout * 1000);
    }
    this._server.listen(port);
    return port;
  }
  close(cb) {
    cb = cb || this._closeCb;
    if (this._timeoutObj !== null) {
      clearTimeout(this._timeoutObj);
      this._timeoutObj = null;
    }
    this._server.close(cb);
  }
}
const assetsDir = path.join(__dirname, './assets');

function check(done, f) {
  try {
    f();
    done();
  } catch (e) {
    done(e);
  }
}

function measure(fn) {
  const start = process.hrtime();
  fn();
  const diff = process.hrtime(start);
  // time in milliseconds
  return (diff[0] * 1e9 + diff[1]) / 1e6;
}

function formatCookie(name, value, days) {
  let expires = '';
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = `; expires=${date.toGMTString()}`;
  } else {
    expires = '';
  }
  return `${name}=${value}${expires};path=/`;
}
function setCookie(res, name, value, days) {
  res.setHeader('Set-Cookie', formatCookie(name, value, days));
}

function parseCookies(req) {
  const cookies = {};
  const data = req.headers.cookie;
  if (!data) return cookies;
  _.each(data.split(';'), c => {
    const parts = c.split('=');
    const name = parts[0].trim();
    const value = parts.slice(1).join('=');
    cookies[name] = value;
  });
  return cookies;
}

function eraseCookie(res, name) {
  setCookie(res, name, '', -1);
}

function getTimeoutFromUrlInSeconds(urlText) {
  const query = url.parse(urlText).query;
  const m = query.match(/^time=(\d+.*)/);
  return m ? parseInt(m[1], 10) : null;
}

function getTimeoutFromUrl(urlText) {
  const timeout = getTimeoutFromUrlInSeconds(urlText);
  return timeout !== null ? timeout * 1000 : null;
}

describe('$Browser', function() {
  this.timeout(50000);
  let server = null;
  let b = null;
  const abs = u => server.absolutize(u);
  const asset = f => path.join(assetsDir, f);
  const assetContents = f => fs.readFileSync(asset(f));
  let testFormUrl = null;
  before(function() {
    server = new MockServer({timeout: 30, closeCb: function() {

    }});
    server.addRoute('get', '/ping', function() {
      this.res.writeHead(200, {'Content-Type': 'text/plain'});
      this.res.end('PONG');
    });
    server.addRoute('get', '/hello', function() {
      this.res.writeHead(200, {'Content-Type': 'text/plain'});
      this.res.end('World!');
    });
    server.addRoute('post', '/testform_submit', function() {
      this.res.writeHead(200);
      this.res.end(JSON.stringify(this.req.body));
    });
    server.addRoute('get', '/testform', function() {
      this.res.writeHead(200);
      this.res.end(assetContents('html/testform.html'));
    });
    server.addRoute('get', '/server_sleep', function() {
      const timeout = getTimeoutFromUrl(this.req.url) || 60000;
      setTimeout(() => {
        this.res.writeHead(200);
        this.res.end('OK');
      }, timeout);
    });
    server.addRoute('get', '/sleep', function() {
      const timeout = getTimeoutFromUrl(this.req.url) || 60000;
      this.res.writeHead(200);
      this.res.end(
        `<html>
<script type="text/javascript">
var id = setInterval(function() { }, 2);
setTimeout(function() {
clearInterval(id);
}, ${timeout})
</script>
</html>
`
      );
    });
    server.addRoute('get', '/xhr', function() {
      const timeout = getTimeoutFromUrlInSeconds(this.req.url) || 60000;
      this.res.writeHead(200);
      this.res.end(
        `
<html>
  <head></head>
  <body>
    <script>
      var xhr = XMLHttpRequest();
      xhr.ontimeout = function (e) {
        throw new Error('Connection timedout!')
      };
      xhr.open('GET', '/server_sleep?time=${timeout}', true);
      xhr.send();
    </script>
  </body>
</html>
`
      );
    });

    server.addRoute('get', '/cookies', function() {
      const query = url.parse(this.req.url).query;
      const cookiesSpec = decodeURI(query) || '';
      const operations = {};
      _.each(cookiesSpec.split('&'), s => {
        const op = s.split('=')[0];
        const data = s.split('=').slice(1).join('=');
        operations[op] = data;
      });
      if (operations.set) {
        const cookies = [];
        _.each(JSON.parse(operations.set), (v, k) => {
          cookies.push(formatCookie(k, v));
        });
        this.res.setHeader('Set-Cookie', cookies);
      }
      if (operations.delete) {
        _.each(operations.delete.split(','), k => eraseCookie(this.res, k));
      }
      this.res.writeHead(200, {'Content-Type': 'application/json'});
      this.res.end(JSON.stringify(parseCookies(this.req)));
    });

    server.listen();
    testFormUrl = abs('/testform');
  });
  beforeEach(function() {
    b = new $Browser();
  });
  afterEach(function() {
    b.close();
  });
  after(function() {
    server.close();
  });
  describe('#visit()', function() {
    it('Allows visiting an url (Plain text)', function(done) {
      b = new $Browser();
      b.visit(abs('/ping')).exec();
      check(done, () => expect(b.text).to.be.eql('PONG'));
    });
    it('Allows visiting an url (HTML text)', function(done) {
      b = new $Browser();
      b.visit(testFormUrl).exec();
      expect(b.html).to.contain('<title>Test Form</title>');
      check(done, () => expect(b.html).to.contain('<title>Test Form</title>'));
    });
  });
  describe('#fill()', function() {
    it('Fills fields individually', function(done) {
      b.visit(testFormUrl).fill('Name', 'Juanjo').fill('Company', 'bitnami').press('Send').exec();
      check(done, () => {
        expect(JSON.parse(b.text)).to.containSubset({
          name_field: 'Juanjo',
          company_field: 'bitnami'
        });
      });
    });
    it('Fills fields in batch mode', function(done) {
      b.visit(testFormUrl).fill({
        Name: 'Ellen',
        Company: 'WY Corp.'
      }).press('Send').exec();
      check(done, () => {
        expect(JSON.parse(b.text)).to.containSubset({
          name_field: 'Ellen',
          company_field: 'WY Corp.'
        });
      });
    });
  });
  describe('#click()', function() {
    it('Allows clicking on links', function() {
      b.visit(testFormUrl).click('Hi').exec();
      expect(b.text).to.be.eql('World!');
    });
  });
  describe('#choose()', function() {
    it('Allows choosing an option', function() {
      b.visit(testFormUrl).choose('subscription', 'pro').press('Send').exec();
      expect(JSON.parse(b.text)).to.containSubset({
        subscription: 'pro'
      });
    });
  });
  describe('#select()', function() {
    it('Allows selecting a dropdown', function() {
      b.visit(testFormUrl).select('location', 'USA').press('Send').exec();
      expect(JSON.parse(b.text)).to.containSubset({
        location: 'usa'
      });
    });
  });
  describe('#check()', function() {
    it('Allows checking checkboxes', function() {
      b.visit(testFormUrl).check('Reading').check('Sports').press('Send').exec();
      expect(JSON.parse(b.text)).to.containSubset({
        reading: 'reading',
        sports: 'sports',
        games: 'games'
      });
    });
  });
  describe('#uncheck()', function() {
    it('Allows unchecking checkboxes', function() {
      b.visit(testFormUrl).uncheck('Games').press('Send').exec();
      expect(JSON.parse(b.text)).to.not.containSubset({
        games: 'games'
      });
    });
  });
  describe('#press()', function() {
    it('Allows Pressing a button', function() {
      b.visit(testFormUrl).press('Send').exec();
      expect(JSON.parse(b.text)).to.containSubset({
        name_field: '',
        company_field: ''
      });
    });
  });
  describe('Cookies Management', function() {
    const sampleCookies = {cookie1: 'value1', cookie2: 'value2', cookie3: 'value3'};
    describe('#setCookie()', function() {
      it('Sets a simple cookie', function() {
        b.setCookie('cookie1', sampleCookies.cookie1);
        b.visit(abs('/cookies')).exec();
        expect(JSON.parse(b.text)).to.eql({cookie1: sampleCookies.cookie1});
      });
      it('Sets a single cookie with complex data', function() {
        // This should not be returned, as is for a different path
        b.setCookie('complex_cookie', {
          domain: server.host,
          path: '/otherurl',
          value: 'value1'
        });
        b.setCookie('complex_cookie2', {
          domain: server.host,
          path: '/cookies',
          value: 'value2'
        });
        b.setCookie('complex_cookie3', {
          domain: server.host,
          path: '/cookies',
          value: 'value3'
        });
        // This should not be returned, as is for a different host
        b.setCookie('complex_cookie4', {
          domain: 'example.com',
          path: '/cookies',
          value: 'value4'
        });
        b.visit(abs('/cookies')).exec();
        expect(JSON.parse(b.text)).to.eql({
          complex_cookie2: 'value2', complex_cookie3: 'value3'
        });
      });
      it('Sets a batch of cookie', function() {
        b.setCookie(sampleCookies);
        b.visit(abs('/cookies')).exec();
        expect(JSON.parse(b.text)).to.be.eql(sampleCookies);
      });
    });
    describe('#getCookie()', function() {
      it('Gets a cookie', function() {
        const cookie = {foo: 'bar'};
        b.visit(abs(`/cookies?set=${encodeURI(JSON.stringify(cookie))}`)).exec();
        expect(b.getCookie('foo')).to.be.eql('bar');
        expect(b.getCookie('foo', {allProperties: true}))
          .to.have.all.keys('value', 'name', 'domain', 'path')
          .and.to.have.property('value').equal('bar');
      });
      it('Gets all cookies', function() {
        b.visit(
          abs(`/cookies?set=${encodeURI(JSON.stringify(sampleCookies))}`)
        ).exec();
        expect(b.getCookies()).to.be.eql(sampleCookies);
        const complexCookies = b.getCookies({allProperties: true});
        expect(complexCookies).to.have.all.keys(_.keys(sampleCookies));
        expect(complexCookies.cookie1.value).to.be.eql('value1');
      });
    });
    describe('#deleteCookie()', function() {
      it('Deletes a cookie', function() {
        b.visit(
          abs(`/cookies?set=${encodeURI(JSON.stringify({foo: 'bar'}))}`)
        ).exec();
        expect(b.getCookie('foo')).to.be.eql('bar');
        b.deleteCookie('foo');
        expect(b.getCookie('foo')).to.be.equal(null);
      });
    });
    describe('#deleteCookies()', function() {
      it('Deletes all cookies', function() {
        b.visit(
          abs(`/cookies?set=${encodeURI(JSON.stringify(sampleCookies))}`)
        ).exec();
        expect(b.getCookies()).to.be.eql(sampleCookies);
        b.deleteCookies();
        expect(b.getCookies()).to.be.eql({});
      });
    });
  });
  // Does not really work
  xdescribe('Waiting()', function() {
    it('Waits for events to finish for a certain time', function() {
      const time = measure(
        () => {
          b.visit(abs('/sleep?time=10'), {wait: '5s'}).exec();
        }
      );
      expect(time).to.be.above(5000).and.below(7000);
    });
  });

  describe('#xmlHttpRequestTimeout', function() {
    it('Defaults to 2m', function() {
      expect(b.evaluate(`
var xhr = XMLHttpRequest();
xhr.timeout;

`)).to.be.eql(120000);
    });
    it('Can be configured', function() {
      const newValue = 10000;
      b.xmlHttpRequestTimeout = newValue;
      expect(b.evaluate(`
var xhr = XMLHttpRequest();
xhr.timeout;

`)).to.be.eql(newValue);
    });
    it('Can be used to limit the time xhr events are waited for', function() {
      b.xmlHttpRequestTimeout = 1000;
      expect(
        measure(
          () => {
            b.visit(abs('/xhr?time=10')).exec();
          }
        )
      ).to.be.above(1000).and.below(1500);
    });
  });
  describe('#evaluate()', function() {
    it('Allows executing code in the context of the page', function() {
      b.visit(
        abs(`/cookies?set=${encodeURI(JSON.stringify({foo: 'bar'}))}`)
      ).exec();
      expect(b.evaluate(`document.cookie.split(';')[0]`)).to.be.eql('foo=bar');
    });
  });

  describe('#describeForm()', function() {
    it('Provides information to easily instrument forms', function() {
      b.visit(testFormUrl).exec();
      const data = b.describeForm();
      expect(data).to.containSubset({
        'check': {},
        'choose': {
          'subscription': 'Free'
        },
        'fill': {
          '#company_field': '',
          '#name_field': ''
        },
        'press': 'submit',
        'select': {
          '#location': ''
        }
      });
    });
  });
});
