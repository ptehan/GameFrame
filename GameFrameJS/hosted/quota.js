const { diskBytes } = require('./store');
function argumentBytes(value) {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + argumentBytes(item), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + argumentBytes(item), 0);
  return 0;
}
function databaseWithQuota(database, directory, limit) {
  return new Proxy(database, { get(target, key) {
    if (key !== 'prepare') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    return sql => {
      const statement = target.prepare(sql);
      return new Proxy(statement, { get(stmt, name) {
        if (name === 'run') return (...args) => {
          if (/^\s*(?:INSERT|UPDATE|REPLACE)\b/i.test(sql)) {
            const incoming = argumentBytes(args);
            if (incoming && diskBytes(directory) + incoming + 65536 > limit()) {
              throw Object.assign(new Error('Workspace storage allowance reached. Delete clips or unused uploads before saving.'), { status: 413 });
            }
          }
          return stmt.run(...args);
        };
        return typeof stmt[name] === 'function' ? stmt[name].bind(stmt) : stmt[name];
      } });
    };
  } });
}
module.exports = { databaseWithQuota, argumentBytes };
