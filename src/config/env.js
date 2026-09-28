import "dotenv/config";
import { parseEnv } from "./env.schema.js";

const env = parseEnv(process.env);

export default env;