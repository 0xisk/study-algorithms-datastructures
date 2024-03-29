pragma circom 2.0.0;

// Refer to:
// https://github.com/peppersec/tornado-mixer/blob/master/circuits/merkleTree.circom
// https://github.com/appliedzkp/semaphore/blob/master/circuits/circom/semaphore-base.circom
// https://github.com/privacy-scaling-explorations/maci/tree/master/circuits/circom/trees

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    component hashers[n];

    //[assignment] insert your code here to compute the root from a leaf and elements along the path
    for (var i = 0; i < n; i++) {
        // TODO: Needs more clarification
        path_index[i] * (1 - path_index[i]) === 0;

        
    }
}
