import registry from '../../../registry/models.json';
export const GET = () => new Response(JSON.stringify(registry), {headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}});
