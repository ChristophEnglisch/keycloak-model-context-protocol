//evals.ts

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const createUserEval: EvalFunction = {
    name: "create-user Evaluation",
    description: "Evaluates the create-user tool by testing user creation in a realm",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please create a user in the 'finance' realm with username 'mjones' and email 'matthew.jones@example.com' and first name 'Matthew' and last name 'Jones'.");
        return JSON.parse(result);
    }
};

const deleteUserEval: EvalFunction = {
    name: 'delete-user Tool Evaluation',
    description: 'Evaluates the ability to delete a user from a specific realm',
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please delete the user with ID 123 in the realm 'myRealm'.");
        return JSON.parse(result);
    }
};

const listRealmsEval: EvalFunction = {
    name: "List Realms Tool Evaluation",
    description: "Evaluates the functionality to list all available realms",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please list all available realms.");
        return JSON.parse(result);
    }
};

const listUsersEval: EvalFunction = {
    name: "list-users Tool Evaluation",
    description: "Evaluates listing users from a given realm",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please list all users in the 'development' realm");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [createUserEval, deleteUserEval, listRealmsEval, listUsersEval]
};
  
export default config;
  
export const evals = [createUserEval, deleteUserEval, listRealmsEval, listUsersEval];