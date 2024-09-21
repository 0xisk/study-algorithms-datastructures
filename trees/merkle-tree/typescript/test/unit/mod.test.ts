import { beforeEach, describe, expect, test } from 'bun:test'
import { MerkleTree } from 'src'

const leaves = [
  'leaf1',
  'leaf2',
  'leaf3',
]

describe('testMerkleTree', () => {
  let tree: MerkleTree

  beforeEach(() => {
    tree = new MerkleTree(leaves)
  })

  test('should return the correct root', () => {
    const root = tree.getRoot()
    expect(root).toBe('There is no root yet!')
  })

  test('should return a valid proof for an existing leaf', () => {
    const leaf = leaves[0] ? leaves[0] : 'WTF there is no leaf'
    const proof = tree.getProof(leaf)
    expect(proof.path).toEqual(['I have no paths :('])
  })

  test('should verify proof for a valid leaf', () => {
    const isValid = tree.verifyProof({
        leaf: "leaf1",
        path: ["I have no paths :("],
        siblings: ["I have no siblings :("]
    })
    expect(isValid).toBeTrue()
  })
})
