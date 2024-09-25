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
      const root = meta.slice(0, 32);
      const depth = meta.readUInt32LE(32);
      return new MerkleTree(db, name, depth, root);
    } else {
      const tree = new MerkleTree(db, name, depth);
      await tree.createEmptyTree();
      return tree;
    }
  }

  private async createEmptyTree() {
    let defaultNode = this.hasher.hash(Buffer.alloc(LEAF_BYTES))

    for (let i = 0; i < this.depth; i++) {
      let parent = this.hasher.compress(defaultNode, defaultNode)
      await this.db.put(parent, Buffer.concat([defaultNode, defaultNode]))
      defaultNode = parent;
    }

    this.root = defaultNode;

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
   * Steps: 
   *  1. Loop top/bottom style starting from the root (r) until we reach to the intended index to get.
   *  2. Create an empty hash path variable; (hp). 
   *  3. At each layer (i) check the parent node data = get(r).
   *  3. Check the size of the data IF it is 0 or 64;
   *    3.1 IF it is 64; read the children, and then push them in the (hp.push([LHS, RHS])).
   *    3.2 we keep moving on to the next layer to to read more children until we reach to the right node. 
   *  4. We update the current node with new parent.  
   *  5. Finally, we return back the hash path but REVERSED. 
   */
  async getHashPath(index: number) {
    let hashPath: Buffer[][] = [];
    let currentNode = this.root;
    let layer = this.depth;

    for (let i = layer - 1; i >= 0; i--) {
      let data = await this.db.get(currentNode).catch(() => Buffer.alloc(0))

      if (data.length === 64) {
        let [leftNode, rightNode] = [data.slice(0, 32), data.slice(32, 64)];
        hashPath.push([leftNode, rightNode]);

        if (this.isLeftNode(index, layer)) {
          currentNode = leftNode;
        } else {
          currentNode = rightNode;
        }
      }

      layer -= 1;
    }

    return new HashPath(hashPath.reverse());
  }

  /**
   * Updates the tree with `value` at `index`. Returns the new tree root.
   * 
   * Steps: 
   *  1. First loop top/bottom from the root r till leaves until the right index.
   *  2. At each layer (i) check the parent data. data = get(r);
   *  3. Check the size of the data. IF it is 0 OR 64;
   *    3.1.IF 0; That means we are in the leaves level and then we can insert/update the value.
   *    3.2 IF 64; That means that is a parent node and we recursively loop into that parent children until it become 0;
   *  4. Update the db with the new parent at end of the loop.
   *  5. After the recursive loop we are supposed to have a newly computed root after the value is being inserted/updated.
   */
  async updateElement(index: number, value: Buffer) {
    this.root = await this.updateElementRecursively(this.root, index, value, this.depth);

    // Save the newly created root. 
    await this.writeMetaData();

    return this.root;
  }

  private async updateElementRecursively(parent: Buffer, index: number, value: Buffer, layer: number) {
    let data: Buffer = await this.db.get(parent).catch(() => Buffer.alloc(0))

    if (data.length === 0) {
      return this.hasher.hash(value);
    } else if (data.length === 64) {
      let [leftNode, rightNode] = [data.slice(0, 32), data.slice(32, 64)]

      let newParent: Buffer;
      if (this.isLeftNode(index, layer)) {
        const updatedLeftNode = await this.updateElementRecursively(leftNode, index, value, layer - 1)
        newParent = this.hasher.compress(updatedLeftNode, rightNode);
        await this.db.put(newParent, Buffer.concat([updatedLeftNode, rightNode]))
        return newParent
      } else {
        const updatedRightNode = await this.updateElementRecursively(rightNode, index, value, layer - 1)
        newParent = this.hasher.compress(leftNode, updatedRightNode);
        await this.db.put(newParent, Buffer.concat([leftNode, updatedRightNode]))
        return newParent
      }
    }

    return this.root
  }

  private isLeftNode(index: number, layer: number) {
    return Math.floor(index / Math.pow(2, layer - 1)) % 2 === 0;
  }
}
