include "../node_modules/circomlib/circuits/poseidon.circom";

template poseidonHashT3() {
    var nInputs = 2;
    signal input inputs[nInputs];
    signal output out;

    component hasher = Poseidon(nInputs);
    for (var i = 0; i < nInputs; i++) {
        hasher.inputs <== nInputs[i];
    }
    out <== hasher.out;
}
