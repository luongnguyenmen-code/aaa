async function run() {
  const adminSid = '76561198354289789';
  const targetSid = '76561198789527189';
  
  console.log("Calling assign-role-slots...");
  const res = await fetch('http://localhost:3000/api/admin/assign-role-slots', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-steam-id': adminSid
    },
    body: JSON.stringify({
      adminSteamId: adminSid,
      targetSteamId: targetSid,
      roleKey: 'default',
      customSlots: 5,
      notes: 'Test cap bao 5 slots'
    })
  });
  
  const json = await res.json();
  console.log("Response:", json);
  
  const listRes = await fetch(`http://localhost:3000/api/admin/roles-slots?adminSteamId=${adminSid}`);
  const listJson = await listRes.json();
  const user = listJson.assignedUsers.find(u => u.steamId === targetSid);
  console.log("User in assignedUsers:", user);
}

run();
