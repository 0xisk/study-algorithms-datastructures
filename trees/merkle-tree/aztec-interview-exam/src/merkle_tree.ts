import { LevelUp, LevelUpChain } from 'levelup';
import { HashPath } from './hash_path';
import { Sha256Hasher } from './sha256_hasher';

const MAX_DEPTH = 32;
const LEAF_BYTES = 64; // All leaf values are 64 bytes.

/**
 * The merkle tree, in summary, is a data structure with a number of indexable elements, and the property
 * that it is possible to provide a succinct proof (HashPath) that a given piece of data, exists at a certain index,
 * for a given merkle tree root.
 */
export class MerkleTree {
  private hasher = new Sha256Hasher();
  private root = Buffer.alloc(32);

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
    if (!(depth >= 1 && depth <= MAX_DEPTH)) {
      throw Error('Bad depth');
    }

    if (root)
      this.root = root
  }

  /**
   * Constructs or restores a new MerkleTree instance with the given `name` and `depth`.
   * The `db` contains the tree data.
   */
  static async new(db: LevelUp, name: string, depth = MAX_DEPTH) {
    const meta: Buffer = await db.get(Buffer.from(name)).catch(() => { });
    if (meta) {
      // There is a tree 
      const root = meta.slice(0, 32);
      const depth = meta.readUInt32LE(32);
      return new MerkleTree(db, name, depth, root);
    } else {
      // There is not tree stored
      const tree = new MerkleTree(db, name, depth);
      await tree.initialize();
      return tree;
    }
  }

  private async initialize() {
    let defaultNode = this.hasher.hash(Buffer.alloc(LEAF_BYTES))

    for (let i = 0; i < this.depth; i++) {
      let parent = this.hasher.compress(defaultNode, defaultNode);
      await this.db.put(parent, Buffer.concat([defaultNode, defaultNode]))
      defaultNode = parent
    }

    this.root = defaultNode;

    // Save the new root
    await this.writeMetaData();
  }

  private async writeMetaData(batch?: LevelUpChain<string, Buffer>) {
    const data = Buffer.alloc(40);
    this.root.copy(data);
    data.writeUInt32LE(this.depth, 32);
    if (batch) {
      batch.put(this.name, data);
    } else {
      await this.db.put(this.name, data);
    }
  }

  getRoot() {
    return this.root;
  }

  /**
   * Returns the hash path for `index`.
   * e.g. To return the HashPath for index 2, return the nodes marked `*` at each layer.
   *     d0:                                            [ root ]
   *     d1:                      [*]                                               [*]
   *     d2:         [*]                      [*]                       [ ]                     [ ]
   *     d3:   [ ]         [ ]          [*]         [*]           [ ]         [ ]          [ ]        [ ]
   * 
   * Step:
   *  1. Loop top/bottom starting from the root `r` until the layer 0.
   *  2. Read the data stored at each parent in each layer.
   *  3. Check if there are data 64, then slit them out into lhs, rhs. 
   *  4. Add those nodes into the hashPath
   *  5. Update the current node at each layer. 
   */
  async getHashPath(index: number) {
    let hashPath: Buffer[][] = [];
    let currentNode = this.root;
    let layer = this.depth;

    for (let i = layer - 1; i >= 0; i--) {
      let data = await this.db.get(currentNode).catch(() => Buffer.alloc(0));

      if (data.length === 64) {
        let [leftSide, rightSide] = [data.slice(0, 32), data.slice(32, 64)];
        hashPath.push([leftSide, rightSide]);

        if (this.isLeftNode(index, layer)) {
          currentNode = leftSide;
        } else {
          currentNode = rightSide;
        }

        layer -= 1
      }
    }

    return new HashPath(hashPath.reverse());
  }

  /**
   * @description Updates the tree with `value` at `index`. Returns the new tree root.
   * 
   * Step: 
   *  1. Loop top/bottom style starting from the root `r` then the current node will be r.
   *  2. Read the data stored in this key `r` at this level. 
   *  3. Check the data buffer size, IF 64, OR 0.
   *   3.1 IF 64; that means this parent has children, then need to detect which path I should follow (left, right).
   *   3.2 Store the new parent of each layer in the DB
   *   3.3 IF 0; that means there is not data stored for this node meaning that this is the right position for the new index.
   *  4. The recursively loop should be ended at the condition of 0, then we will have the newly computed root after updating that element.
   *  5. Finally save the newly root in the state of the class.
   */
  async updateElement(index: number, value: Buffer) {
    this.root = await this.updateElementRecursively(this.root, index, value, this.depth);

    // Save the newly root in the DB
    await this.writeMetaData();

    return this.root;
  }

  private async updateElementRecursively(parent: Buffer, index: number, value: Buffer, layer: number): Promise<Buffer> {
    let data = await this.db.get(parent).catch(() => Buffer.alloc(0))

    if (data.length === 0) {
      return this.hasher.hash(value);
    } else if (data.length === 64) {
      let [leftSide, rightSide] = [data.slice(0, 32), data.slice(32, 64)];

      let newParent: Buffer;
      if (this.isLeftNode(index, layer)) {
        const newLeftNode = await this.updateElementRecursively(leftSide, index, value, layer - 1);
        newParent = this.hasher.compress(newLeftNode, rightSide);
        await this.db.put(newParent, Buffer.concat([newLeftNode, rightSide]))
        return newParent;
      } else {
        const newRightNode = await this.updateElementRecursively(rightSide, index, value, layer - 1);
        newParent = this.hasher.compress(leftSide, newRightNode);
        await this.db.put(newParent, Buffer.concat([leftSide, newRightNode]))
        return newParent;
      }
    }

    throw new Error("Data Format is not support")
  }

  private isLeftNode(index: number, layer: number) {
    return Math.floor(index / Math.pow(2, layer - 1) % 2) === 0;
  }
}
