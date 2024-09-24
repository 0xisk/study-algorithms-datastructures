import { hash } from 'bun'
import { LevelUp, LevelUpChain } from 'levelup'
import { HashPath } from './hashPath'
import { Sha256Hasher } from './sha256'
import { getTree, saveTree } from './utils'

export { HashPath } from './hashPath'
export { Sha256Hasher } from './sha256'

const MAX_DEPTH = 32
const LEAF_BYTES = 64 // All leaf values are 64 bytes.

type Proof = {
  leaf: string
  path: string[]
  siblings: string[]
}

interface IMerkleTree {
  /**
   * Returns the root hash of the Tree
   *
   * @returns {Buffer} The root hash of the tree.
   */
  getRoot(): Buffer

  /**
   * Updates the tree with `value` at `index`. Returns the new tree root.
   */
  updateElement(index: number, value: Buffer): Promise<Buffer>

  /**
   * Returns the hash path for `index`.
   * e.g. To return the HashPath for index 2, return the nodes marked `*` at each layer.
   *     d0:                                            [ root ]
   *     d1:                      [*]                                               [*]
   *     d2:         [*]                      [*]                       [ ]                     [ ]
   *     d3:   [ ]         [ ]          [*]         [*]           [ ]         [ ]          [ ]        [ ]
   */
  getHashPath(index: number): Promise<HashPath>

  /**
   * Verifies the validity of the proof
   * @param {Proof} proof - The proof components that are needed for the verification.
   * @returns {boolean} Returns TRUE/FALSE value depending on the validity of the proof.
   */
  verifyProof(proof: Proof): Promise<boolean>
}

export class MerkleTree implements IMerkleTree {
  private hasher = new Sha256Hasher()
  private root = Buffer.alloc(32)

  /**
   * Constructs a new MerkleTree instance, either initializing an empty tree, or restoring pre-existing state values.
   * Use the async static `new` function to construct.
   *
   * @param db Underlying leveldb.
   * @param name Name of the tree, to be used when restoring/persisting state.
   * @param depth The depth of the tree, to be no greater than MAX_DEPTH.
   * @param root When restoring, you need to provide the root.
   */
  constructor(private db: LevelUp, private name: string, private depth: number, root?: Buffer) {
    if (!(depth >= 1 && depth <= MAX_DEPTH))
      throw Error('Bad depth')
  }

  /**
   * Constructs or restores a new MerkleTree instance with the given `name` and `depth`.
   * The `db` contains the tree data.
   */
  static async new(db: LevelUp, name: string, depth = MAX_DEPTH) {
    const meta: Buffer = await db.get(Buffer.from(name)).catch(() => { })
    if (meta) {
      const root = meta.slice(0, 32)
      const depth = meta.readUInt32LE(32)
      const tree = new MerkleTree(db, name, depth, root)
      await tree.intialize()
      return tree
    } else {
      const tree = new MerkleTree(db, name, depth)
      await tree.writeMetaData()
      await tree.intialize()
      return tree
    }
  }

  private async intialize() {
    const storedTree = await getTree(this.db)
    if (storedTree) {
      this.root = storedTree![storedTree!.length - 1]![0]!;
    } else {
      await this.createEmtyTree()
    }
  }

  private async createEmtyTree() {
    let tree: Buffer[][] = []
    let defaultNode = this.hasher.hash(Buffer.alloc(LEAF_BYTES))

    for (let i = 0; i < this.depth; i++) {
      let parent = this.hasher.compress(defaultNode, defaultNode);
      tree.push([parent])
      defaultNode = parent
    }

    this.root = tree[tree.length - 1]![0]!

    await saveTree(this.db, tree).catch((error) => console.error(error))
  }

  private async writeMetaData(batch?: LevelUpChain<string, Buffer>) {
    const data = Buffer.alloc(40)
    this.root.copy(data)
    data.writeUInt32LE(this.depth, 32)
    if (batch)
      batch.put(this.name, data)
    else
      await this.db.put(this.name, data)
  }

  getRoot() {
    return this.root
  }

  async getHashPath(index: number): Promise<HashPath> {
    if (index >= Math.pow(2, this.depth))
      throw Error('No enough space in the thee')

    let tree = await getTree(this.db)

    if (tree == undefined)
      throw Error('Please construct the tree')

    let currentIndex = index
    let path: Buffer[][] = []

    // Insert the path
    for (let i = 0; i < tree.length; i++) {
      // Check if the root
      if (tree[i]?.length === 1) break

      let isLeftNode = currentIndex % 2 == 0

      if (isLeftNode)
        path.push([tree[i]![currentIndex]!, tree[i]![currentIndex + 1]!])
      else
        path.push([tree[i]![currentIndex - 1]!, tree[i]![currentIndex]!])

      currentIndex = Math.floor(currentIndex / 2)
    }

    return new HashPath(path)
  }

  async updateElement(index: number, value: Buffer): Promise<Buffer> {
    if (index >= Math.pow(2, this.depth))
      throw Error('No enough space in the thee')

    let tree = await getTree(this.db)
    if (tree === undefined)
      throw Error('Please construct the tree')

    let currentIndex = index
    let newParent = this.hasher.hash(value)

    // Loop over all layers of the tree
    for (let i = 0; i < tree.length; i++) {
      // 1. Update tree with the new element value in that index
      tree[i]![currentIndex] = newParent

      // Check if the root
      if (tree[i]?.length === 1) break

      // 2. Check if that index is left or right
      // If left: hash(index, index + 1)
      // If right: hash(index - 1, index)
      let isLeftNode = currentIndex % 2 == 0

      // 3. Update the parent of the updated element with its sibling.
      if (isLeftNode) {
        newParent = this.hasher.compress(
          tree[i]![currentIndex]!,
          tree[i]![currentIndex + 1]!,
        )
      } else {
        newParent = this.hasher.compress(
          tree[i]![currentIndex - 1]!,
          tree[i]![currentIndex]!,
        )
      }

      currentIndex = Math.floor(currentIndex / 2)
    }

    let max = tree.length - 1

    // Get the latest updated root
    this.root = tree[max]![0]!

    await saveTree(this.db, tree)

    return this.root
  }

  async verifyProof(proof: { leaf: string; path: string[]; siblings: string[] }): Promise<boolean> {
    // implement
    return true
  }
}
