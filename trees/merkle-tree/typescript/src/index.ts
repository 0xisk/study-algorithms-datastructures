type Proof = {
  leaf: string
  path: string[]
  siblings: string[]
}

interface IMerkleTree {
  /**
   * Returns the root hash of the Tree
   *
   * @returns {string} The root hash of the tree.
   */
  getRoot(): string

  /**
   * Generates a Proof for the element at the given index.
   * @param {number} leaf - The element in the tree for which the proof is generated.
   * @return {Proof} The inclusion proof of an element in a tree.
   */
  getProof(leaf: string): Proof

  /**
   * Verifies the validity of the proof
   * @param {Proof} proof - The proof components that are needed for the verification.
   * @returns {boolean} Returns TRUE/FALSE value depending on the validity of the proof.
   */
  verifyProof(proof: Proof): boolean
}

export class MerkleTree implements IMerkleTree {
  constructor(leaves: string[]) {
    return
  }

  getRoot(): string {
    return 'There is no root yet!'
  }

  getProof(leaf: string): { leaf: string; path: string[]; siblings: string[] } {
    return {
      leaf: 'Sorry',
      path: ['I have no paths :('],
      siblings: ['I have no siblings :('],
    }
  }

  verifyProof(proof: { leaf: string; path: string[]; siblings: string[] }): boolean {
    return true
  }
}
