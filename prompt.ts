export const generateFunctionPrompt = <I, O>(description: string, inputs: I, output: O) => `
Generate a fully typed typescript function based on the given description, input schema and output schema to be passed into eval function.
Example:

description: 'Return a happy birthday message to the person mentioning the age.' 
input: { readonly name: string; readonly age: number }
output: string

function main(person: { readonly name: string; readonly age: number }): string {
return \`Happy birthday \${person.name}. You're now \${person.age} years old\`
}


Make sure the function is called 'main'. 
Make sure the response is in a text format.Not a code block.
Generate a single function with the following description, inputs and output schema:
description: ${description}
inputs: ${inputs}
output: ${output}
`;

export const retryGenerateFunctionPrompt = <I, O>(description: string, inputs: I, output: O, previousAttempts: Array<{ response: string, error: string }>) =>
    `${generateFunctionPrompt(description, inputs, output)}
Generate a fully typed typescript function based on the given description, input schema and output schema to be passed into eval function.
Example:

description: 'Return a happy birthday message to the person mentioning the age.' 
input: { readonly name: string; readonly age: number }
output: string

function main(person: { readonly name: string; readonly age: number }): string {
return \`Happy birthday \${person.name}. You're now \${person.age} years old\`
}


Make sure the function is called 'main'. 
Make sure the response is in a text format.Not a code block.

${previousAttempts.map(attempt => `For the reponse: ${attempt.response}, the error was: ${attempt.error}`).join('\n')}

Please retry and generate a single function with the following description, inputs and output schema:
description: ${description}
inputs: ${inputs}
output: ${output}
`;
