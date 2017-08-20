const Update = require('immutability-helper');

interface SetTreeOptions {
  path: string; // Root is '#', and delimiters are dots
  updater: any;
}

Update.extend('$updatePath', function (options : SetTreeOptions, obj) {
  /**
   * Create a updater;
   */
  function makeUpdater(path : string[], value) {
    if (path.length == 0) {
      return options.updater(value);
    } else {
      let key = path[0];
      return {
        [path[0]]: makeUpdater(path.slice(1), value[key]),
      };
    }
  }

  let path = options.path.split('.');
  if (path[0] == '#') {
    path = path.slice(1);
  }
  let updater = makeUpdater(path, obj);

  return Update(obj, updater);
});

export function update(obj, updater) {
  return Update(obj, updater);
}

