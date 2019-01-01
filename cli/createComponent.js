const fs = require('fs');
const { pascalCasify, getPreviousDir, createFile, getConfig, isConfigValid, getConfigFromCommand } = require('./utils');
const createFolder = require('./create-folder');

// all the pre-defined file type
const allFilesType = ['component', 'style', 'container', 'interface', 'test'];

const inArray = (needle, haystack = []) => {
  var length = haystack.length;
  for (var i = 0; i < length; i++) {
    if(haystack[i].toLowerCase() === needle.toLowerCase()) return true;
  }
  return false;
}

// the way it has been made, doesn't work in asynchrone with return statement, so it return a promise
// find the a file position in the structure
const findFilePosition = (structure, search, parents = []) => new Promise((resolve, reject) => {
  for (const key in structure) {
    if (structure.hasOwnProperty(key)) {
      const element = structure[key];
      const currentPositions = {
        search,
        folder: parents[parents.length - 1] || key,
        parents,
      };
      if(element.constructor.name === 'Object') findFilePosition(element, search, [...parents, key]).then(resolve).catch(reject);
      else if(Array.isArray(element)) element.forEach(elt => {
        if(elt === search) return resolve({ ...currentPositions, contains: element });
      });
      else if(element === search) return resolve(currentPositions);
    }
  }
});

// we stock the files position in an object and return it if there's the expected amount of data
const tempFilesPositionStore = expectingFilesPositionNumber => {
  let filesPositionNumber = 0;
  const filesPosition = {};
  return {
    addFilePosition: filePosition => {
      ++filesPositionNumber;
      filesPosition[filePosition.search] = filePosition;
      return expectingFilesPositionNumber === filesPositionNumber;
    },
    getFilesPosition: () => filesPosition
  }
}

// find all the files position
const findAllFilesPosition = structure => new Promise((resolve, reject) => {
  const store = tempFilesPositionStore(allFilesType.length);
  allFilesType.forEach(fileType => {
    findFilePosition(structure, fileType)
      .then(filePosition => {
        if(store.addFilePosition(filePosition)) return resolve(store.getFilesPosition());
      })
      .catch(reject);
  });
});

module.exports = (component, command) => new Promise((resolve, reject) => {
  const configCLI = getConfigFromCommand(command);
  let files = ['style', 'component']; // this contains all the files type that are going to be created
  const config = getConfig();
  isConfigValid(config, reject); // if the config is invalid we do not want to continue
  const { structure, style } = config;
  findAllFilesPosition(configCLI.structure || structure)
    .then(filesPosition => {
      component.name = component.name.replace(/\\/g, '/');
      component.name = /src\/components/.test(component.name)
        ? component.name
        : `src/components/${component.name}`;

      if(configCLI.tests !== false && config.tests === true) files.push('test');
      // contains is defined only if the value is an array (e.g. "component": ["component", "container"])
      if(!filesPosition.container.contains) files.push('container');
      if(configCLI.scriptsType !== 'jsx' && config.scriptsType === 'tsx' && !filesPosition.interface.contains) files.push('interface');

      const options = {
        componentType: component.type,
        scriptsType: config.scriptsType,
        mDS: config.MDS,
        structure,
        filesPosition,
        style,
        configCLI,
      };
      creation(component.name, options, files).then(resolve).catch(reject);
    })
    .catch(reject);
});

const creation = (componentName, options, files) => new Promise((resolve, reject) => {
  if(files.length === 0) return resolve();
  options.fileType = files[0];
  files.shift();
  createComponent(componentName, options).then(() => {
    creation(componentName, options, files).then(resolve).catch(reject);
  }).catch(reject);
});

const createComponent = (path, options) => {
  const { fileType, mDS, structure, filesPosition, style, configCLI } = options;
  path = correctPath(path, options); // find the correct path where the file will be created
  let pathParts = path.split(/[/\\]/);
  const componentName = pascalCasify(/index/i.test(pathParts[pathParts.length - 1])
    ? pathParts[pathParts.length - 2]
    : pathParts[pathParts.length - 1]);

  const tempPath = `${getPreviousDir(__dirname, true)}/templates`;
  const templatePath = getTemplatePath(options); // find the correct path to the template that will be used for the file
  let ext = getExt(options); // find the correct extension
  let finalTemplatePath = `${tempPath}/${templatePath}`;
  if(fileType !== 'style') finalTemplatePath += `.${ext}`; // the style's template doesn't have an extension
  const previousDir = getPreviousDir(path);
  pathParts[pathParts.length - 1] = componentName;
  const creationPath = pathParts.join('/');

  const createFileOptions = {
    creationPath: `${creationPath}.${ext}`,
    readFilePath: finalTemplatePath,
    fileType,
    componentName,
    mDS,
    structure,
    filesPosition,
    style,
    configCLI,
  };
  return new Promise((resolve, reject) => {
    fs.exists(previousDir, exists => {
      if(!exists) createFolder(previousDir) // if the folder where the file shall be created doesn't exist, we create it then create the file once it's done
        .then(() => createFile(createFileOptions).then(resolve).catch(reject))
        .catch(reject);
      else createFile(createFileOptions).then(resolve).catch(reject);
    });
  });
}

const correctPath = (path, options) => {
  const { fileType, filesPosition } = options;
  let correctPath = path;

  const filePosition = filesPosition[fileType];
  // filePosition doesn't necessary have parents, there's parents if there's 1+ nested structure
  correctPath = correctPath.replace('components', filePosition.parents.join('/') || filePosition.folder);
  if(filesPosition[fileType].parents.length > 0) correctPath += '/index';
  return correctPath;
}

const getTemplatePath = options => {
  let { componentType, scriptsType, fileType, filesPosition, configCLI } = options;

  let path;
  if(fileType === 'style') return 'style';
  path = configCLI.scriptsType || scriptsType;
  if(fileType === 'test') return `${path}/test`;

  const { contains } = filesPosition[fileType];
  if(inArray('component', contains) && inArray('container', contains) && inArray('interface', contains)) path += '/all';
  else if(configCLI.scriptsType === 'tsx' || scriptsType === 'jsx' || fileType === 'component') path += '/components';
  else if(fileType === 'interface') path += '/interfaces';
  else if(fileType === 'container') return `${path}/container`;

  componentType.substring(1);
  path += `/${componentType}-component`;
  return path;
}

const getExt = options => {
  const { scriptsType, fileType, style, configCLI } = options;
  let ext;
  if(fileType === 'style') ext = configCLI.style || style;
  else if(configCLI.scriptsType === 'jsx' || scriptsType === 'jsx') ext = 'js';
  else ext = 'tsx';

  return ext;
}
