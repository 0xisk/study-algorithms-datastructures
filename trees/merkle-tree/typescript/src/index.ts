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
  getHashPath2(index: number): Promise<HashPath>

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
    if (root)
      this.root = root
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
      return tree
    } else {
      const tree = new MerkleTree(db, name, depth)
      await tree.createEmptyTree()
      return tree
    }
  }

  private async createEmptyTree() {
    let tree: Buffer[][] = []
    let defaultNode = this.hasher.hash(Buffer.alloc(LEAF_BYTES))

    for (let i = 0; i < this.depth; i++) {
      let parent = this.hasher.compress(defaultNode, defaultNode);
      await this.db.put(parent, Buffer.concat([defaultNode, defaultNode]))
      tree.push([parent])
      defaultNode = parent
    }

    this.root = tree[tree.length - 1]![0]!

    // Update tree meta
    await this.writeMetaData()
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

  //
  async getHashPath2(index: number): Promise<HashPath> {
    let hashPath: Buffer[][] = [];
    let currentNode = this.root;
    let layer = this.depth;

    for (let i = layer - 1; i >= 0; i--) {
      // If:
      // (case 1) Data = 64; That means both nodes at leyer[i] are not empty, so we will fill them into the hashPath 
      // (case 2) Data = 65; That means one of the subtrees is a stump 
      // (case 3) Data = 0;  That means we reached at the level where both subtrees are completely empty. We use a pre-computed zero hash to fill the path.
      let data = await this.db.get(currentNode).catch(() => Buffer.alloc(0))

      // Case 1
      if (data.length === 64) {
        let [leftChild, rightChild] = [data.slice(0, 32), data.slice(32, 64)];
        hashPath.push([leftChild, rightChild])

        if (this.isLeftNode(index, layer)) {
          currentNode = leftChild;
        } else {
          currentNode = rightChild
        }
      }

      // Case 2
      if (data.length === 65) {
        throw new Error("NOT SUPPORTED")
      }

      // Case 3 
      if (data.length === 0) {
        throw new Error("NOT SUPPORTED")
      }

      layer = layer - 1
    }

    // You need to reverse the array since we are looping from top/down and the expected tests are written bottom up.
    return new HashPath(hashPath.reverse())
  }

  async getHashPath(index: number): Promise<HashPath> {
    let hashPath: Buffer[][] = [];
    let currentNode = this.root; // Start from the root
    let currentLayer = this.depth;

    // Traverse the tree from the root to the leaf
    for (let i = currentLayer - 1; i >= 0; i--) {
      // Read the data from the current node
      let data = await this.db.get(currentNode).catch(() => Buffer.alloc(0));

      if (data.length === 64) {
        // Step 3: Regular internal node (both left and right subtrees are non-empty)
        const leftChild = data.slice(0, 32);
        const rightChild = data.slice(32, 64);

        // Fill in the hash path for this level with the left and right children
        hashPath.push([leftChild, rightChild]);

        // Recursively move down to the next level
        if (this.isLeftNode(index, i)) {
          currentNode = leftChild;
        } else {
          currentNode = rightChild;
        }
      } else if (data.length === 65) {
        // Step 4: We've reached a stump node
        const filledLeaf = data.slice(0, 64);  // The leaf value in the stump
        const storedIndex = data.readUInt32BE(64);  // The index stored in the stump

        // Fill in the hash path with the reconstructed subtree information
        hashPath.push([filledLeaf]);

        if (storedIndex === index) {
          // If the stored index matches the index we are looking for, break early
          break;
        } else {
          // Fork the stump if necessary (keep traversing)
          currentNode = this.computeZeroRoot(i - 1); // Use zero hashes for the remaining layers
        }
      } else if (data.length === 0) {
        // Step 5: We've reached an empty subtree, fill with zero hashes
        hashPath.push([this.computeZeroRoot(i - 1), this.computeZeroRoot(i - 1)]);
        break;  // No need to continue further as the rest of the path is zero hashes
      }
    }

    return new HashPath(hashPath);  // Return the collected hash path
  }

  // Helper function to compute zero root
  private computeZeroRoot(layer: number): Buffer {
    let zeroHash = this.hasher.hash(Buffer.alloc(64)); // 64 zero bytes
    for (let i = 0; i < layer; i++) {
      zeroHash = this.hasher.compress(zeroHash, zeroHash);
    }
    return zeroHash;
  }

  private async recursiveUpdateElement(parent: Buffer, value: Buffer, index: number, layer: number): Promise<Buffer> {
    const data = await this.db.get(parent).catch(() => Buffer.alloc(0));;

    console.log("Data", data.length)
    // Case 1: Empty 
    if (data.length === 0) {
      const indexedBuffer = Buffer.alloc(32);
      indexedBuffer.writeUint32LE(index, 0);
      const hashedValue = this.hasher.hash(value);
      console.log("hashedValue", hashedValue.length)
      const stumpFlag = Buffer.from([1]); // Boolean "true" in 1 byte

      const stumpNode = Buffer.concat([hashedValue, indexedBuffer, stumpFlag]);
      console.log("stumpNode", stumpNode.length)

      return stumpNode
    }

    // Case 2:
    if (data.length === 65) {
      // Extract the 32-byte value
      const existingValue = data.slice(0, 32);

      const storedIndex = data.readUInt32LE(32);

      const stumpFlag = data.readUInt8(36);
      console.log("stumpFlag", stumpFlag === 1 ? true : false);

      if (storedIndex === index) {
        const hashedValue = this.hasher.hash(value);
        return hashedValue
      } else {
        const hashedValue = this.hasher.hash(value);

        const leftChild = storedIndex < index
          ? existingValue
          : hashedValue;

        const rightChild = storedIndex < index
          ? hashedValue
          : existingValue;

        const newParentHash = this.hasher.compress(leftChild, rightChild);
        return newParentHash;
      }
    }

    if (data.length === 64) {
      const [leftChild, rightChild] = [data.slice(0, 32), data.slice(32, 64)];

      if (this.isLeftNode(index, layer)) {
        const updatedLeft = await this.recursiveUpdateElement(leftChild, value, index, layer - 1)

        
        const parent = this.hasher.compress(updatedLeft.slice(0, 32), rightChild)
        await this.db.put(parent, Buffer.concat([updatedLeft.slice(0, 32), rightChild]))
        return parent
      } else {
        const updatedRight = await this.recursiveUpdateElement(rightChild, value, index, layer - 1)
        const parent = this.hasher.compress(leftChild, updatedRight.slice(0, 32))
        await this.db.put(parent, Buffer.concat([leftChild, updatedRight.slice(0, 32)]))
        return parent

      }
    }

    throw new Error('Unexpected data format');
  }

  private async function saveLeaf(leaf: Buffer) {
    // This is a stump
    if (leaf.length === 65) {
      return this.hasher()
    }
  }

  private isLeftNode(index: number, layer: number): Boolean {
    return Math.floor(index / Math.pow(2, layer - 1)) % 2 === 0
  }

  async updateElement(index: number, value: Buffer): Promise<Buffer> {
    this.root = await this.recursiveUpdateElement(this.root, value, index, this.depth)

    // Update the tree
    await this.writeMetaData();

    return this.root
  }

  async verifyProof(proof: { leaf: string; path: string[]; siblings: string[] }): Promise<boolean> {
    // implement
    return true
  }
}
