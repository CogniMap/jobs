export function reduce(obj, attributes : string[])
{
  let newObj = {};
  for (let key in obj) {
    if (attributes.indexOf(key) !== -1) {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}
