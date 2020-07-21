/* eslint-env mocha */
'use strict'

const { fixtures, clearPins, expectPinned, pinTypes } = require('./utils')
const { getDescribe, getIt, expect } = require('../utils/mocha')
const all = require('it-all')
const drain = require('it-drain')
const {
  DAGNode
} = require('ipld-dag-pb')
const testTimeout = require('../utils/test-timeout')
const CID = require('cids')

/** @typedef { import("ipfsd-ctl/src/factory") } Factory */
/**
 * @param {Factory} common
 * @param {Object} options
 */
module.exports = (common, options) => {
  const describe = getDescribe(options)
  const it = getIt(options)

  describe('.pin.add', function () {
    this.timeout(50 * 1000)

    let ipfs
    before(async () => {
      ipfs = (await common.spawn()).api

      await Promise.all(fixtures.files.map(file => {
        return ipfs.add(file.data, { pin: false })
      }))

      await all(
        ipfs.add(fixtures.directory.files.map(
          file => ({
            path: file.path,
            content: file.data
          })
        ), {
          pin: false
        })
      )
    })

    after(() => common.clean())

    beforeEach(() => {
      return clearPins(ipfs)
    })

    async function testAddInput (source) {
      const pinset = await all(ipfs.pin.add(source))

      expect(pinset).to.have.deep.members([
        fixtures.files[0].cid,
        fixtures.files[1].cid
      ])
    }

    it('should add a CID and return the added CID', async () => {
      const pinset = await all(ipfs.pin.add(fixtures.files[0].cid))
      expect(pinset).to.deep.include(fixtures.files[0].cid)
    })

    it('should add a pin with options and return the added CID', async () => {
      const pinset = await all(ipfs.pin.add({
        cid: fixtures.files[0].cid,
        recursive: false
      }))
      expect(pinset).to.deep.include(fixtures.files[0].cid)
    })

    it('should add an array of CIDs', () => {
      return testAddInput([
        fixtures.files[0].cid,
        fixtures.files[1].cid
      ])
    })

    it('should add a generator of CIDs', () => {
      return testAddInput(function * () {
        yield fixtures.files[0].cid
        yield fixtures.files[1].cid
      }())
    })

    it('should add an async generator of CIDs', () => {
      return testAddInput(async function * () { // eslint-disable-line require-await
        yield fixtures.files[0].cid
        yield fixtures.files[1].cid
      }())
    })

    it('should add an array of pins with options', () => {
      return testAddInput([
        {
          cid: fixtures.files[0].cid,
          recursive: false
        },
        {
          cid: fixtures.files[1].cid,
          recursive: true
        }
      ])
    })

    it('should add a generator of pins with options', () => {
      return testAddInput(function * () {
        yield {
          cid: fixtures.files[0].cid,
          recursive: false
        }
        yield {
          cid: fixtures.files[1].cid,
          recursive: true
        }
      }())
    })

    it('should add an async generator of pins with options', () => {
      return testAddInput(async function * () { // eslint-disable-line require-await
        yield {
          cid: fixtures.files[0].cid,
          recursive: false
        }
        yield {
          cid: fixtures.files[1].cid,
          recursive: true
        }
      }())
    })

    it('should add recursively', async () => {
      await drain(ipfs.pin.add(fixtures.directory.cid))
      await expectPinned(ipfs, fixtures.directory.cid, pinTypes.recursive)

      const pinChecks = Object.values(fixtures.directory.files).map(file => expectPinned(ipfs, file.cid))
      return Promise.all(pinChecks)
    })

    it('should add directly', async () => {
      await drain(ipfs.pin.add({
        cid: fixtures.directory.cid,
        recursive: false
      }))
      await Promise.all([
        expectPinned(ipfs, fixtures.directory.cid, pinTypes.direct),
        expectPinned(ipfs, fixtures.directory.files[0].cid, false)
      ])
    })

    it('should recursively pin parent of direct pin', async () => {
      await drain(ipfs.pin.add({
        cid: fixtures.directory.files[0].cid,
        recursive: false
      }))
      await drain(ipfs.pin.add(fixtures.directory.cid))
      await Promise.all([
        // file is pinned both directly and indirectly o.O
        expectPinned(ipfs, fixtures.directory.files[0].cid, pinTypes.direct),
        expectPinned(ipfs, fixtures.directory.files[0].cid, pinTypes.indirect)
      ])
    })

    it('should fail to directly pin a recursive pin', async () => {
      await drain(ipfs.pin.add(fixtures.directory.cid))
      return expect(drain(ipfs.pin.add({
        cid: fixtures.directory.cid,
        recursive: false
      })))
        .to.eventually.be.rejected()
        .with(/already pinned recursively/)
    })

    it('should fail to pin a hash not in datastore', function () {
      this.slow(3 * 1000)
      this.timeout(5 * 1000)
      const falseHash = `${`${fixtures.directory.cid}`.slice(0, -2)}ss`
      return expect(drain(ipfs.pin.add(falseHash, { timeout: '2s' })))
        .to.eventually.be.rejected()
        // TODO: http api TimeoutErrors do not have this property
        // .with.a.property('code').that.equals('ERR_TIMEOUT')
    })

    it('needs all children in datastore to pin recursively', async function () {
      this.slow(3 * 1000)
      this.timeout(5 * 1000)
      await all(ipfs.block.rm(fixtures.directory.files[0].cid))

      await expect(drain(ipfs.pin.add(fixtures.directory.cid, { timeout: '2s' })))
        .to.eventually.be.rejected()
    })

    it('should pin dag-cbor', async () => {
      const cid = await ipfs.dag.put({}, {
        format: 'dag-cbor',
        hashAlg: 'sha2-256'
      })

      await drain(ipfs.pin.add(cid))

      const pins = await all(ipfs.pin.ls())

      expect(pins).to.deep.include({
        type: 'recursive',
        cid
      })
    })

    it('should pin raw', async () => {
      const cid = await ipfs.dag.put(Buffer.alloc(0), {
        format: 'raw',
        hashAlg: 'sha2-256'
      })

      await drain(ipfs.pin.add(cid))

      const pins = await all(ipfs.pin.ls())

      expect(pins).to.deep.include({
        type: 'recursive',
        cid
      })
    })

    it('should pin dag-cbor with dag-pb child', async () => {
      const child = await ipfs.dag.put(new DAGNode(Buffer.from(`${Math.random()}`)), {
        format: 'dag-pb',
        hashAlg: 'sha2-256'
      })
      const parent = await ipfs.dag.put({
        child
      }, {
        format: 'dag-cbor',
        hashAlg: 'sha2-256'
      })

      await drain(ipfs.pin.add(parent, {
        recursive: true
      }))

      const pins = await all(ipfs.pin.ls())

      expect(pins).to.deep.include({
        cid: parent,
        type: 'recursive'
      })
      expect(pins).to.deep.include({
        cid: child,
        type: 'indirect'
      })
    })

    it('should respect timeout option when pinning a block', () => {
      return testTimeout(() => ipfs.pin.add(new CID('Qmd7qZS4T7xXtsNFdRoK1trfMs5zU94EpokQ9WFtxdPxsZ'), {
        timeout: 1
      }))
    })
  })
}
