import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { tools } from '../src/tools.js';

test('codeFixer Tool Suite', async (t) => {
  const testFile = 'scratch/test-code-fixer-temp.js';
  const resolvedPath = path.resolve(process.cwd(), testFile);

  const setupFile = async (content) => {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, 'utf-8');
  };

  const cleanupFile = async () => {
    try {
      await fs.unlink(resolvedPath);
    } catch {
      // ignore
    }
  };

  await t.test('write and append operations', async () => {
    await cleanupFile();
    
    // Write whole file
    let res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        { action: 'write', content: 'console.log("hello");\\n' }
      ],
      lintAndFormat: false
    });
    
    assert.equal(res.success, true);
    let content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'console.log("hello");\n');

    // Append to file
    res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        { action: 'append', content: 'console.log("world");\\n' }
      ],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'console.log("hello");\nconsole.log("world");\n');

    await cleanupFile();
  });

  await t.test('replace and anchor-isolated modifications', async () => {
    const original = `function add(a, b) {
  // TODO: implement
  return 0;
}

function sub(a, b) {
  // TODO: implement
  return 0;
}`;
    await setupFile(original);

    // Replace "// TODO: implement" with "return a + b;" only inside add function
    const res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        {
          action: 'replace',
          startAnchor: 'function add(a, b) {',
          endAnchor: '}',
          search: '// TODO: implement\\n  return 0;',
          replace: 'return a + b;'
        }
      ],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    
    // Verify that the add function got updated
    assert.ok(content.includes('return a + b;'));
    // Verify that the sub function did NOT get updated
    assert.ok(content.includes('function sub(a, b) {\n  // TODO: implement\n  return 0;\n}'));

    await cleanupFile();
  });

  await t.test('insert_before and insert_after operations', async () => {
    const original = `const x = 10;
const y = 20;`;
    await setupFile(original);

    const res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        {
          action: 'insert_before',
          search: 'const y',
          content: 'const middle = 15;\\n'
        },
        {
          action: 'insert_after',
          search: 'const y = 20;',
          content: '\\nconst z = 30;'
        }
      ],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'const x = 10;\nconst middle = 15;\nconst y = 20;\nconst z = 30;');

    await cleanupFile();
  });

  await t.test('line ranges isolation', async () => {
    const original = `line 1
line 2
line 3
line 4`;
    await setupFile(original);

    const res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        {
          action: 'replace',
          startLine: 2,
          endLine: 3,
          search: 'line',
          replace: 'modified'
        }
      ],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'line 1\nmodified 2\nmodified 3\nline 4');

    await cleanupFile();
  });

  await t.test('dry-run simulation returns a clean diff', async () => {
    const original = 'original text';
    await setupFile(original);

    const res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        { action: 'write', content: 'new simulated text' }
      ],
      dryRun: true
    });

    assert.equal(res.success, true);
    assert.ok(res.diff.includes('- original text'));
    assert.ok(res.diff.includes('+ new simulated text'));

    const content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'original text');

    await cleanupFile();
  });

  await t.test('multi-file correlation scanning across languages', async () => {
    const fileJS = 'scratch/temp_js.js';
    const filePy = 'scratch/temp_py.py';
    const fileGo = 'scratch/temp_go.go';
    const fileCpp = 'scratch/temp_cpp.cpp';
    const fileJava = 'scratch/temp_java.java';
    const fileRust = 'scratch/temp_rust.rs';
    const fileRuby = 'scratch/temp_ruby.rb';
    const fileDart = 'scratch/temp_dart.dart';
    const fileLua = 'scratch/temp_lua.lua';
    const filePerl = 'scratch/temp_perl.pl';
    const fileR = 'scratch/temp_r.r';
    const fileHaskell = 'scratch/temp_haskell.hs';
    const fileElixir = 'scratch/temp_elixir.ex';
    const fileClojure = 'scratch/temp_clojure.clj';
    const fileJulia = 'scratch/temp_julia.jl';
    const fileSql = 'scratch/temp_sql.sql';
    const fileCss = 'scratch/temp_css.css';
    const fileScss = 'scratch/temp_scss.scss';
    const fileSass = 'scratch/temp_sass.sass';
    const fileLess = 'scratch/temp_less.less';

    const pathJS = path.resolve(process.cwd(), fileJS);
    const pathPy = path.resolve(process.cwd(), filePy);
    const pathGo = path.resolve(process.cwd(), fileGo);
    const pathCpp = path.resolve(process.cwd(), fileCpp);
    const pathJava = path.resolve(process.cwd(), fileJava);
    const pathRust = path.resolve(process.cwd(), fileRust);
    const pathRuby = path.resolve(process.cwd(), fileRuby);
    const pathDart = path.resolve(process.cwd(), fileDart);
    const pathLua = path.resolve(process.cwd(), fileLua);
    const pathPerl = path.resolve(process.cwd(), filePerl);
    const pathR = path.resolve(process.cwd(), fileR);
    const pathHaskell = path.resolve(process.cwd(), fileHaskell);
    const pathElixir = path.resolve(process.cwd(), fileElixir);
    const pathClojure = path.resolve(process.cwd(), fileClojure);
    const pathJulia = path.resolve(process.cwd(), fileJulia);
    const pathSql = path.resolve(process.cwd(), fileSql);
    const pathCss = path.resolve(process.cwd(), fileCss);
    const pathScss = path.resolve(process.cwd(), fileScss);
    const pathSass = path.resolve(process.cwd(), fileSass);
    const pathLess = path.resolve(process.cwd(), fileLess);

    await fs.mkdir(path.dirname(pathJS), { recursive: true });
    await fs.writeFile(pathJS, 'class Vehicle {\n  drive() {}\n}\nfunction startEngine() {}\nconst myVehicle = new Vehicle();\n', 'utf-8');
    await fs.writeFile(pathPy, 'class Car:\n    pass\ndef honk_horn():\n    pass\nv = Vehicle()\n', 'utf-8');
    await fs.writeFile(pathGo, 'package main\ntype Boat struct {}\nfunc sailBoat() {}\n', 'utf-8');
    await fs.writeFile(pathCpp, 'class Train {};\nvoid boardTrain() {}\n', 'utf-8');
    await fs.writeFile(pathJava, 'public class Airplane {\n  public void fly() {}\n}\n', 'utf-8');
    await fs.writeFile(pathRust, 'struct Rocket;\nfn launch_rocket() {}\n', 'utf-8');
    await fs.writeFile(pathRuby, 'class Helicopter\nend\ndef search_and_rescue\nend\n', 'utf-8');
    await fs.writeFile(pathDart, 'class SpaceStation {\n  void orbit() {}\n}\n', 'utf-8');
    await fs.writeFile(pathLua, 'function teleport()\nend\n', 'utf-8');
    await fs.writeFile(pathPerl, 'package TimeMachine;\nsub travel_back\n', 'utf-8');
    await fs.writeFile(pathR, 'setClass("S4Rocket")\nlaunch_r <- function() {}\n', 'utf-8');
    await fs.writeFile(pathHaskell, 'data WarpDrive = Warp\nengage :: Int -> IO ()\n', 'utf-8');
    await fs.writeFile(pathElixir, 'defmodule TelepathicLink do\n  def send_thought do\n  end\nend\n', 'utf-8');
    await fs.writeFile(pathClojure, '(ns quantum-entanglement)\n(defn entangle [])\n', 'utf-8');
    await fs.writeFile(pathJulia, 'struct GravityWell\nend\nfunction bend_spacetime()\nend\n', 'utf-8');
    await fs.writeFile(pathSql, 'CREATE TABLE Supernova (id INT);\nCREATE PROCEDURE explode() BEGIN END;\n', 'utf-8');
    await fs.writeFile(pathCss, '.style-button { color: blue; }\n@keyframes slide-in {}\n', 'utf-8');
    await fs.writeFile(pathScss, '%alert-base { border: 1px solid; }\n.modal-box { color: red; }\n@mixin center-flex {}\n', 'utf-8');
    await fs.writeFile(pathSass, '.sass-box\n  color: green\n=sass-mixin\n  display: block\n', 'utf-8');
    await fs.writeFile(pathLess, '.less-title { color: #fff; }\n.rounded-corners() {}\n', 'utf-8');

    const res = await tools.codeFixer.execute({
      correlate: {
        files: [
          fileJS, filePy, fileGo, fileCpp, fileJava, fileRust, fileRuby,
          fileDart, fileLua, filePerl, fileR, fileHaskell, fileElixir,
          fileClojure, fileJulia, fileSql, fileCss, fileScss, fileSass, fileLess
        ]
      },
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    assert.ok(res.correlations);
    
    const { definitions, references } = res.correlations;
    
    const defNames = definitions.map(d => d.name);
    assert.ok(defNames.includes('Vehicle'));
    assert.ok(defNames.includes('startEngine'));
    assert.ok(defNames.includes('Car'));
    assert.ok(defNames.includes('honk_horn'));
    assert.ok(defNames.includes('Boat'));
    assert.ok(defNames.includes('sailBoat'));
    assert.ok(defNames.includes('Train'));
    assert.ok(defNames.includes('boardTrain'));
    assert.ok(defNames.includes('Airplane'));
    assert.ok(defNames.includes('fly'));
    assert.ok(defNames.includes('Rocket'));
    assert.ok(defNames.includes('launch_rocket'));
    assert.ok(defNames.includes('Helicopter'));
    assert.ok(defNames.includes('search_and_rescue'));

    // Verify new languages
    assert.ok(defNames.includes('SpaceStation'), 'Dart class SpaceStation');
    assert.ok(defNames.includes('orbit'), 'Dart function orbit');
    assert.ok(defNames.includes('teleport'), 'Lua function teleport');
    assert.ok(defNames.includes('TimeMachine'), 'Perl package TimeMachine');
    assert.ok(defNames.includes('travel_back'), 'Perl sub travel_back');
    assert.ok(defNames.includes('S4Rocket'), 'R class S4Rocket');
    assert.ok(defNames.includes('launch_r'), 'R function launch_r');
    assert.ok(defNames.includes('WarpDrive'), 'Haskell data WarpDrive');
    assert.ok(defNames.includes('engage'), 'Haskell function engage');
    assert.ok(defNames.includes('TelepathicLink'), 'Elixir defmodule TelepathicLink');
    assert.ok(defNames.includes('send_thought'), 'Elixir function send_thought');
    assert.ok(defNames.includes('quantum-entanglement'), 'Clojure ns quantum-entanglement');
    assert.ok(defNames.includes('entangle'), 'Clojure function entangle');
    assert.ok(defNames.includes('GravityWell'), 'Julia struct GravityWell');
    assert.ok(defNames.includes('bend_spacetime'), 'Julia function bend_spacetime');
    assert.ok(defNames.includes('Supernova'), 'SQL table Supernova');
    assert.ok(defNames.includes('explode'), 'SQL procedure explode');

    // Verify stylesheets
    assert.ok(defNames.includes('style-button'), 'CSS class style-button');
    assert.ok(defNames.includes('slide-in'), 'CSS keyframes slide-in');
    assert.ok(defNames.includes('alert-base'), 'SCSS placeholder alert-base');
    assert.ok(defNames.includes('modal-box'), 'SCSS class modal-box');
    assert.ok(defNames.includes('center-flex'), 'SCSS mixin center-flex');
    assert.ok(defNames.includes('sass-box'), 'Sass class sass-box');
    assert.ok(defNames.includes('sass-mixin'), 'Sass mixin sass-mixin');
    assert.ok(defNames.includes('less-title'), 'Less class less-title');
    assert.ok(defNames.includes('rounded-corners'), 'Less mixin rounded-corners');

    const vehicleDef = definitions.find(d => d.name === 'Vehicle');
    assert.equal(vehicleDef.type, 'class');
    const startEngineDef = definitions.find(d => d.name === 'startEngine');
    assert.equal(startEngineDef.type, 'function');

    const airplaneDef = definitions.find(d => d.name === 'Airplane');
    assert.equal(airplaneDef.type, 'class');
    const flyDef = definitions.find(d => d.name === 'fly');
    assert.equal(flyDef.type, 'function');

    assert.ok(references.Vehicle);
    const vehicleRefs = references.Vehicle;
    assert.equal(vehicleRefs.length, 2);
    assert.ok(vehicleRefs.some(r => r.file === filePy && r.line === 5));

    await fs.unlink(pathJS);
    await fs.unlink(pathPy);
    await fs.unlink(pathGo);
    await fs.unlink(pathCpp);
    await fs.unlink(pathJava);
    await fs.unlink(pathRust);
    await fs.unlink(pathRuby);
    await fs.unlink(pathDart);
    await fs.unlink(pathLua);
    await fs.unlink(pathPerl);
    await fs.unlink(pathR);
    await fs.unlink(pathHaskell);
    await fs.unlink(pathElixir);
    await fs.unlink(pathClojure);
    await fs.unlink(pathJulia);
    await fs.unlink(pathSql);
    await fs.unlink(pathCss);
    await fs.unlink(pathScss);
    await fs.unlink(pathSass);
    await fs.unlink(pathLess);
  });

  await t.test('multi-file propagation and renaming across files', async () => {
    const fileJS = 'scratch/temp_js.js';
    const filePy = 'scratch/temp_py.py';

    const pathJS = path.resolve(process.cwd(), fileJS);
    const pathPy = path.resolve(process.cwd(), filePy);

    await fs.mkdir(path.dirname(pathJS), { recursive: true });
    await fs.writeFile(pathJS, 'class Vehicle {\n  drive() {}\n}\nfunction startEngine() {}\nconst myVehicle = new Vehicle();\n', 'utf-8');
    await fs.writeFile(pathPy, 'class Car:\n    pass\ndef honk_horn():\n    pass\nv = Vehicle()\n', 'utf-8');

    const res = await tools.codeFixer.execute({
      propagateCorrelations: [
        { search: 'Vehicle', replace: 'ElectricVehicle' }
      ],
      files: [fileJS, filePy],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    assert.ok(res.modifiedFiles.includes(fileJS));
    assert.ok(res.modifiedFiles.includes(filePy));

    const contentJS = await fs.readFile(pathJS, 'utf-8');
    const contentPy = await fs.readFile(pathPy, 'utf-8');

    assert.ok(contentJS.includes('class ElectricVehicle'));
    assert.ok(contentJS.includes('const myVehicle = new ElectricVehicle();'));
    assert.ok(contentPy.includes('v = ElectricVehicle()'));

    assert.ok(!contentJS.includes('class Vehicle'));

    await fs.unlink(pathJS);
    await fs.unlink(pathPy);
  });

  await t.test('functionality search and enclosing context attribution', async () => {
    const fileSearchJS = 'scratch/temp_search.js';
    const fileSearchPy = 'scratch/temp_search.py';

    const pathSearchJS = path.resolve(process.cwd(), fileSearchJS);
    const pathSearchPy = path.resolve(process.cwd(), fileSearchPy);

    await fs.mkdir(path.dirname(pathSearchJS), { recursive: true });
    
    const jsContent = `/**
 * Math utilities class
 */
class MathUtils {
  // Adds two numbers
  add(a, b) {
    /* inline comment */
    return a + b;
  }
}

function computeDifference(a, b) {
  return a - b;
}

const product = (a, b) => a * b; // Arrow function
`;

    const pyContent = `class Calculator:
    """Class docstring"""
    def multiply(self, a, b):
        # Perform multiplication
        return a * b

def divide(a, b):
    # Perform division
    return a / b
`;

    await fs.writeFile(pathSearchJS, jsContent, 'utf-8');
    await fs.writeFile(pathSearchPy, pyContent, 'utf-8');

    // 1. Basic search for "return" with comments included
    let res = await tools.codeFixer.execute({
      searchFunctionality: {
        query: 'return',
        files: [fileSearchJS, fileSearchPy],
        includeComments: true
      },
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    assert.ok(res.functionalities);
    assert.equal(res.functionalities.query, 'return');
    
    const matches = res.functionalities.matches;
    assert.ok(matches.length >= 3);

    const addMatch = matches.find(m => m.file === fileSearchJS && m.lineContent.includes('return a + b'));
    assert.ok(addMatch);
    assert.ok(addMatch.enclosingFunctionality);
    assert.equal(addMatch.enclosingFunctionality.name, 'MathUtils');
    assert.equal(addMatch.enclosingFunctionality.type, 'class');

    const diffMatch = matches.find(m => m.file === fileSearchJS && m.lineContent.includes('return a - b'));
    assert.ok(diffMatch);
    assert.ok(diffMatch.enclosingFunctionality);
    assert.equal(diffMatch.enclosingFunctionality.name, 'computeDifference');
    assert.equal(diffMatch.enclosingFunctionality.type, 'function');

    // 2. Search with includeComments: false
    res = await tools.codeFixer.execute({
      searchFunctionality: {
        query: 'comment',
        files: [fileSearchJS],
        includeComments: false
      },
      lintAndFormat: false
    });
    assert.equal(res.success, true);
    assert.equal(res.functionalities.matches.length, 0);

    // 3. Search with includeComments: true
    res = await tools.codeFixer.execute({
      searchFunctionality: {
        query: 'comment',
        files: [fileSearchJS],
        includeComments: true
      },
      lintAndFormat: false
    });
    assert.equal(res.success, true);
    assert.ok(res.functionalities.matches.length > 0);

    // 4. Search with includeDefinitionsOnly: true
    res = await tools.codeFixer.execute({
      searchFunctionality: {
        query: 'divide',
        files: [fileSearchPy],
        includeDefinitionsOnly: true
      },
      lintAndFormat: false
    });
    assert.equal(res.success, true);
    assert.equal(res.functionalities.matches.length, 1);
    const defMatch = res.functionalities.matches[0];
    assert.equal(defMatch.isDefinition, true);
    assert.equal(defMatch.definitionName, 'divide');
    assert.equal(defMatch.definitionType, 'function');

    await fs.unlink(pathSearchJS);
    await fs.unlink(pathSearchPy);
  });

  await t.test('optional search parameters for replace, insert_before, and insert_after', async () => {
    const original = `hello
world
foo
bar`;
    await setupFile(original);

    // 1. replace without search parameter
    let res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        {
          action: 'replace',
          startLine: 2,
          endLine: 3,
          replace: 'replaced_lines'
        }
      ],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    let content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'hello\nreplaced_lines\nbar');

    // 2. insert_before without search parameter
    await setupFile(original);
    res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        {
          action: 'insert_before',
          startLine: 2,
          endLine: 3,
          content: 'inserted_before\n'
        }
      ],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'hello\ninserted_before\nworld\nfoo\nbar');

    // 3. insert_after without search parameter
    await setupFile(original);
    res = await tools.codeFixer.execute({
      filePath: testFile,
      operations: [
        {
          action: 'insert_after',
          startLine: 2,
          endLine: 3,
          content: '\ninserted_after'
        }
      ],
      lintAndFormat: false
    });

    assert.equal(res.success, true);
    content = await fs.readFile(resolvedPath, 'utf-8');
    assert.equal(content, 'hello\nworld\nfoo\ninserted_after\nbar');

    await cleanupFile();
  });
});

