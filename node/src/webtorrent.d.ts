declare module 'webtorrent' {
  export default class WebTorrent {
    constructor(opts?: any)
    seed(input: any, opts?: any, cb?: (torrent: any) => void): any
    add(torrentId: string, opts?: any, cb?: (torrent: any) => void): any
    remove(torrentId: string, opts?: any, cb?: (err?: Error) => void): void
    get(torrentId: string): any
    destroy(cb?: (err?: Error) => void): void
    torrents: any[]
  }
}
