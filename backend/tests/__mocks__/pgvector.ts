function toSql(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function fromSql(value: string | null): number[] | null {
  if (value === null) return null;
  return value.replace(/[[\]]/g, '').split(',').map(Number);
}

module.exports = { toSql, fromSql };
