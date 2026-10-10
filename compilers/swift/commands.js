export const resourceDir = '/swift/lib/swift';
export function driver(optimization = '0', debug = false) {
  return ['swiftc',
    debug || optimization === '0' ? '-Onone' : optimization === '3' ? '-Osize' : '-O',
    ...(debug ? ['-gdwarf-types', '-Xfrontend', '-dwarf-version=4'] : [])];
}

export function link(object, output) {
  return ['swiftc', object, '-o', output];
}
