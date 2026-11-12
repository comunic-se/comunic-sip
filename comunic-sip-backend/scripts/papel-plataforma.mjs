// Papéis de PLATAFORMA (acima das empresas): SUPER_ADMIN e PARTNER_ADMIN.
// Mínimo privilégio: ninguém recebe esses papéis automaticamente. Para manutenção
// do dia a dia use o acesso de emergência (scripts/admin-emergencia.mjs).
//
//   listar
//   adicionar <helenaUserId> SUPER_ADMIN
//   adicionar <helenaUserId> PARTNER_ADMIN <partnerId>
//   remover   <helenaUserId> <SUPER_ADMIN|PARTNER_ADMIN>
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const [, , cmd, userId, role, partnerId] = process.argv;
const ROLES = ['SUPER_ADMIN', 'PARTNER_ADMIN'];

try {
  if (cmd === 'listar') {
    const rows = await prisma.platformRole.findMany({ orderBy: { createdAt: 'asc' } });
    if (!rows.length) console.log('Nenhum papel de plataforma cadastrado.');
    for (const r of rows) console.log(`${r.helenaUserId}  ${r.role}${r.partnerId ? '  parceiro=' + r.partnerId : ''}  (criado por ${r.createdBy ?? '?'} em ${r.createdAt.toISOString()})`);
  } else if (cmd === 'adicionar') {
    if (!userId || !ROLES.includes(role) || (role === 'PARTNER_ADMIN' && !partnerId)) throw new Error('uso: adicionar <helenaUserId> SUPER_ADMIN | PARTNER_ADMIN <partnerId>');
    await prisma.platformRole.create({ data: { helenaUserId: userId, role, partnerId: role === 'PARTNER_ADMIN' ? partnerId : null, createdBy: 'script' } });
    await prisma.auditLog.create({ data: { actor: 'script', action: 'platform_role_add', payload: { helenaUserId: userId, role, partnerId: partnerId ?? null } } });
    console.log(`Papel ${role} concedido a ${userId}. Vale a partir do próximo login.`);
  } else if (cmd === 'remover') {
    if (!userId || !ROLES.includes(role)) throw new Error('uso: remover <helenaUserId> <SUPER_ADMIN|PARTNER_ADMIN>');
    const r = await prisma.platformRole.deleteMany({ where: { helenaUserId: userId, role } });
    await prisma.auditLog.create({ data: { actor: 'script', action: 'platform_role_remove', payload: { helenaUserId: userId, role, removed: r.count } } });
    console.log(r.count ? `Papel ${role} removido de ${userId}. A sessão atual dele continua até expirar (máx. 12 h) — peça para recarregar o painel.` : 'Nada para remover.');
  } else {
    console.log('uso: node scripts/papel-plataforma.mjs <listar|adicionar|remover> ...');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
