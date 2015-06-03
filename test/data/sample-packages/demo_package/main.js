'use strict';

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
  $file.append('steps.txt', 'postInstallation', {atNewLine: true});
};

$app.preUninstallation = function() {
  $file.append('steps.txt', 'preUninstallation', {atNewLine: true});
};

$app.postUninstallation = function() {
  $file.append('steps.txt', 'postUninstallation', {atNewLine: true});
};
