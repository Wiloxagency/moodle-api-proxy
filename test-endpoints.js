// Test script for participant CRUD endpoints
// Run this after starting the server: node test-endpoints.js

const API_BASE = 'http://localhost:3000/api';

async function testEndpoints() {
    console.log('🧪 Testing Participant CRUD Endpoints...\n');

    // Test data
    const testParticipant = {
        numeroInscripcion: 'TEST-001',
        nombres: 'Juan Carlos',
        apellidos: 'González López',
        rut: '12.345.678-9',
        mail: 'juan.gonzalez@test.com',
        telefono: '+56912345678',
        franquiciaPorcentaje: 75,
        costoOtic: 150000,
        costoEmpresa: 50000,
        estadoInscripcion: 'Inscrito',
        observacion: 'Participante de prueba'
    };

    try {
        // 1. Test CREATE (POST /api/participantes)
        console.log('1️⃣ Testing CREATE participant...');
        const createResponse = await fetch(`${API_BASE}/participantes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testParticipant)
        });
        
        if (createResponse.ok) {
            const created = await createResponse.json();
            console.log('✅ CREATE successful:', created.data._id);
            const participantId = created.data._id;
            
            // 2. Test LIST (GET /api/participantes)
            console.log('\n2️⃣ Testing LIST participants...');
            const listResponse = await fetch(`${API_BASE}/participantes?numeroInscripcion=TEST-001`);
            const list = await listResponse.json();
            console.log('✅ LIST successful:', list.data.length, 'participants found');
            
            // 3. Test UPDATE (PUT /api/participantes/:id)
            console.log('\n3️⃣ Testing UPDATE participant...');
            const updateData = { nombres: 'Juan Carlos UPDATED' };
            const updateResponse = await fetch(`${API_BASE}/participantes/${participantId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            });
            const updated = await updateResponse.json();
            console.log('✅ UPDATE successful:', updated.data.nombres);
            
            // 4. Test DELETE (DELETE /api/participantes/:id)
            console.log('\n4️⃣ Testing DELETE participant...');
            const deleteResponse = await fetch(`${API_BASE}/participantes/${participantId}`, {
                method: 'DELETE'
            });
            const deleted = await deleteResponse.json();
            console.log('✅ DELETE successful:', deleted.success);
            
        } else {
            console.error('❌ CREATE failed:', createResponse.status, await createResponse.text());
        }
    } catch (error) {
        console.error('❌ Error testing endpoints:', error.message);
        console.log('\n💡 Make sure the server is running with: npm start');
    }
}

testEndpoints();
