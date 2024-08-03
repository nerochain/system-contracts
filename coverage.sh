#!/bin/bash -

set -o nounset # Treat unset variables as an error

rm -rf cache
# uncomment only-test
# change Staking to converage 
sed -i'.bak' '5d' contracts/Staking.sol 
sed -i'.bak'  '/require(block.number == 0/d' contracts/GenesisLock.sol 
sed -i'.bak1'  '/require(block.number == 0/d' contracts/Staking.sol 
sed -i'.bak2' 's/onlyEngine/\/\/onlyEngine/g' contracts/Staking.sol 

# change Validator to converage 
sed -i'.bak' '5d' contracts/Validator.sol 
# delete mock files
mv contracts/mock/MockList.sol contracts/mock/MockList.sol.bak
mv contracts/mock/MockValidator.sol  contracts/mock/MockValidator.sol.bak
# delete the solpp plugin fo hardhat.config.ts
sed -i '.bak' '3d' hardhat.config.ts
# adapt test scripts
sed -i '.bak' 's/cache\/solpp-generated-contracts\/GenesisLock.sol://g' test/GenesisLock.js
sed -i '.bak' 's/cache\/solpp-generated-contracts\/Validator.sol://g' test/staking-exit-and-claim.js
sed -i '.bak1' 's/cache\/solpp-generated-contracts\/Staking.sol://g' test/staking-exit-and-claim.js

sed -i '.bak' 's/cache\/solpp-generated-contracts\/Validator.sol://g' test/staking.js
sed -i '.bak1' 's/cache\/solpp-generated-contracts\/Staking.sol://g' test/staking.js

sed -i '.bak' 's/cache\/solpp-generated-contracts\/Validator.sol://g' test/validator.js

npx hardhat coverage

mv contracts/mock/MockList.sol.bak contracts/mock/MockList.sol
mv contracts/mock/MockValidator.sol.bak  contracts/mock/MockValidator.sol
mv contracts/GenesisLock.sol.bak contracts/GenesisLock.sol
mv contracts/Staking.sol.bak contracts/Staking.sol 
rm contracts/Staking.sol.bak1
rm contracts/Staking.sol.bak2
mv contracts/Validator.sol.bak contracts/Validator.sol 
mv hardhat.config.ts.bak hardhat.config.ts
mv test/GenesisLock.js.bak test/GenesisLock.js
mv test/staking-exit-and-claim.js.bak test/staking-exit-and-claim.js
rm test/staking-exit-and-claim.js.bak1
mv test/staking.js.bak test/staking.js
rm test/staking.js.bak1
mv test/validator.js.bak test/validator.js 
rm test/validator.js.bak1

rm -rf coverage
rm -rf artifacts
rm -rf cache