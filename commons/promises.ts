const Promise = require('bluebird');

/**
 * Same behavior that a numbered for, but with promises.
 *
 * The @param callback must return the value of breakFor and continueFor when using them.
 */
export function promisesFor<T>(array : T[], callback : {
  (i : number, item : T, breakFor: {(value): void;}, continueFor: {() : void;}) : Promise<any>|any;
}) : Promise<any> {
  return new Promise((resolve, reject) => {
    function next(i : number) {
      if (i >= array.length) {
        return;
      }

      let item = array[i];
      try {
        let res = callback(i, item, (value) => {
          resolve(value);
          return "__internal__";
        }, () => {
          next(i + 1);
          return "__internal__";
        });

        if (res == "__internal__") {
          return;
        } else if (res.then != null) { // It's a promise
          res.catch(reject).then(() => {
            next(i + 1);
          });
        } else { // A simple value or null
          next(i + 1);
        }
      } catch (err) {
        reject(err);
      }
    }

    return next(0);
  });
}

