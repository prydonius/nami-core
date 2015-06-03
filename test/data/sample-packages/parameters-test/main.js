'use strict';
const _ = require('lodash');

$app.preInstallChecks = function() {
  $file.append('steps.txt', 'preInstallChecks', {atNewLine: true});
};

$app.preInstallation = function() {
  $file.append('steps.txt', 'preInstallation', {atNewLine: true});
};

$app.preUnpackFiles = function() {
  $file.append('steps.txt', 'preUnpackFiles', {atNewLine: true});
};

$app.postUnpackFiles = function() {
  $file.append('steps.txt', 'postUnpackFiles', {atNewLine: true});
};

$app.postInstallation = function() {
  $file.write('options.json', JSON.stringify(_.pick(
    $app,
    ['password', 'name', 'force', 'start_services']
  )));
  $file.append('steps.txt', 'postInstallation', {atNewLine: true});
};

$app.preUninstallation = function() {
  $file.append('steps.txt', 'preUninstallation', {atNewLine: true});
};

$app.postUninstallation = function() {
  $file.append('steps.txt', 'postUninstallation', {atNewLine: true});
};
