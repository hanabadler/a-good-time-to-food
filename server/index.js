const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Family Members Routes
app.get('/api/family-members', async (req, res) => {
  try {
    const members = await prisma.familyMember.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/family-members', async (req, res) => {
  try {
    const { name, isChild, gender } = req.body;
    const member = await prisma.familyMember.create({
      data: { 
        name, 
        isChild: isChild || false,
        gender: gender && gender !== '' ? gender : null
      }
    });
    res.json(member);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/family-members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isChild, gender } = req.body;
    const member = await prisma.familyMember.update({
      where: { id: parseInt(id) },
      data: { 
        name, 
        isChild,
        gender: gender && gender !== '' ? gender : null
      }
    });
    res.json(member);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/family-members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.familyMember.delete({
      where: { id: parseInt(id) }
    });
    res.json({ message: 'Member deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Products Routes
app.get('/api/products', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        rules: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, quantity, unit, ruleType } = req.body;
    const productData = {
      name,
        quantity: parseInt(quantity) || 0,
      rules: {
        create: {
          ruleType: ruleType || 'everyone'
        }
      }
    };
    
    // Only include unit if it's not empty
    if (unit && unit.trim() !== '') {
      productData.unit = unit.trim();
    }
    
    const product = await prisma.product.create({
      data: productData,
      include: {
        rules: true
      }
    });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, quantity, unit, ruleType } = req.body;
    
    // Update product
    const updateData = { 
      name, 
      quantity: parseFloat(quantity) || 0
    };
    
    // Only include unit if it's not empty, otherwise set to null explicitly
    if (unit && unit.trim() !== '') {
      updateData.unit = unit.trim();
    } else {
      updateData.unit = null;
    }
    
    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: updateData
    });
    
    // Update or create rule
    if (ruleType) {
      const existingRule = await prisma.productRule.findFirst({
        where: { productId: parseInt(id) }
      });
      
      if (existingRule) {
        await prisma.productRule.update({
          where: { id: existingRule.id },
          data: { ruleType }
        });
      } else {
        await prisma.productRule.create({
          data: { productId: parseInt(id), ruleType }
        });
      }
    }
    
    const updatedProduct = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: { rules: true }
    });
    
    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.product.delete({
      where: { id: parseInt(id) }
    });
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Transactions Routes
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await prisma.transaction.findMany({
      include: {
        product: true,
        member: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { productId, memberId, quantity, notes } = req.body;
    
    // Get product and check availability
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { rules: true }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Check rule
    const rule = product.rules[0];
    if (rule) {
      const member = await prisma.familyMember.findUnique({
        where: { id: parseInt(memberId) }
      });
      
      if (rule.ruleType === 'children_only' && !member.isChild) {
        return res.status(403).json({ error: 'This product is only for children' });
      }
      if (rule.ruleType === 'adults_only' && member.isChild) {
        return res.status(403).json({ error: 'This product is only for adults' });
      }
    }
    
    // Check quantity
    if (product.quantity < quantity) {
      return res.status(400).json({ error: 'Not enough quantity available' });
    }
    
    // Get member
    const member = await prisma.familyMember.findUnique({
      where: { id: parseInt(memberId) }
    });
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Calculate original quantity (current quantity + all transactions for this product)
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: parseInt(productId) }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    
    // Calculate fair share
    const allMembers = await prisma.familyMember.findMany();
    const productRule = product.rules[0];
    let eligibleMembers = [];
    
    if (!productRule || productRule.ruleType === 'everyone') {
      eligibleMembers = allMembers;
    } else if (productRule.ruleType === 'children_only') {
      eligibleMembers = allMembers.filter(m => m.isChild);
    } else if (productRule.ruleType === 'adults_only') {
      eligibleMembers = allMembers.filter(m => !m.isChild);
    }
    
    if (eligibleMembers.length === 0) {
      return res.status(400).json({ error: 'No eligible members for this product' });
    }
    
    const fairShare = Math.floor(originalQuantity / eligibleMembers.length);
    
    // Calculate how much the member has already taken
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(memberId)
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much the member has already transferred
    const existingTransfersOut = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        fromMemberId: parseInt(memberId)
      }
    });
    
    const totalTransferred = existingTransfersOut.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much the member has received from transfers
    const existingTransfersIn = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        toMemberId: parseInt(memberId)
      }
    });
    
    const totalReceived = existingTransfersIn.reduce((sum, t) => sum + t.quantity, 0);
    
    // Total available = fair share - taken - transferred + received
    const totalAvailable = fairShare - totalTaken - totalTransferred + totalReceived;
    
    // Check if trying to take more than total available
    if (parseInt(quantity) > totalAvailable) {
      return res.status(400).json({ 
        error: `אין אפשרות לקחת יותר מההקצבה שלך. ההקצבה שלך: ${fairShare}, כבר לקחת: ${totalTaken}, כבר העברת: ${totalTransferred}, קיבלת: ${totalReceived}, זמין לך: ${totalAvailable}` 
      });
    }
    
    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        productId: parseInt(productId),
        memberId: parseInt(memberId),
        quantity: parseInt(quantity),
        notes: notes || null
      },
      include: {
        product: true,
        member: true
      }
    });
    
    // Update product quantity
    await prisma.product.update({
      where: { id: parseInt(productId) },
      data: {
        quantity: product.quantity - parseInt(quantity)
      }
    });
    
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Share Transfer Routes
app.post('/api/share-transfers', async (req, res) => {
  try {
    const { productId, fromMemberId, toMemberId, quantity } = req.body;
    
    // Check if shareTransfer model exists
    if (!prisma.shareTransfer) {
      console.error('prisma.shareTransfer is undefined');
      return res.status(500).json({ 
        error: 'ShareTransfer model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    // Get product
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { rules: true }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Get members
    const fromMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(fromMemberId) }
    });
    const toMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(toMemberId) }
    });
    
    if (!fromMember || !toMember) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    if (fromMemberId === toMemberId) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }
    
    // Calculate fair share for fromMember
    const allMembers = await prisma.familyMember.findMany();
    const productRule = product.rules[0];
    let eligibleMembers = [];
    
    if (!productRule || productRule.ruleType === 'everyone') {
      eligibleMembers = allMembers;
    } else if (productRule.ruleType === 'children_only') {
      eligibleMembers = allMembers.filter(m => m.isChild);
    } else if (productRule.ruleType === 'adults_only') {
      eligibleMembers = allMembers.filter(m => !m.isChild);
    }
    
    if (eligibleMembers.length === 0) {
      return res.status(400).json({ error: 'No eligible members for this product' });
    }
    
    // Calculate original quantity
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: parseInt(productId) }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    
    const fairShare = Math.floor(originalQuantity / eligibleMembers.length);
    
    // Calculate how much fromMember has already taken
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(fromMemberId)
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much fromMember has already transferred
    let existingTransfers = [];
    let totalTransferred = 0;
    
    try {
      existingTransfers = await prisma.shareTransfer.findMany({
        where: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId)
        }
      });
      totalTransferred = existingTransfers.reduce((sum, t) => sum + t.quantity, 0);
    } catch (transferError) {
      console.error('Error fetching transfers:', transferError);
      // If shareTransfer doesn't exist, assume no transfers yet
      totalTransferred = 0;
    }
    
    // Calculate remaining fair share
    const remainingFairShare = fairShare - totalTaken - totalTransferred;
    
    // Check if trying to transfer more than remaining fair share
    if (parseInt(quantity) > remainingFairShare) {
      return res.status(400).json({ 
        error: `אין אפשרות להעביר יותר מההקצבה שלך. ההקצבה שלך: ${fairShare}, כבר לקחת: ${totalTaken}, כבר העברת: ${totalTransferred}, נשאר לך: ${remainingFairShare}` 
      });
    }
    
    // Create transfer
    let transfer;
    try {
      transfer = await prisma.shareTransfer.create({
        data: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId),
          toMemberId: parseInt(toMemberId),
          quantity: parseInt(quantity)
        },
        include: {
          product: true,
          fromMember: true,
          toMember: true
        }
      });
    } catch (createError) {
      console.error('Error creating transfer:', createError);
      console.error('Error details:', {
        message: createError.message,
        code: createError.code,
        meta: createError.meta
      });
      
      if (createError.message && createError.message.includes('shareTransfer')) {
        return res.status(500).json({ 
          error: 'ShareTransfer model not found. Please run: npx prisma generate and restart the server',
          details: createError.message
        });
      }
      
      throw createError;
    }
    
    res.json(transfer);
  } catch (error) {
    console.error('Error in share transfer:', error);
    console.error('Full error:', JSON.stringify(error, null, 2));
    res.status(500).json({ 
      error: error.message || 'שגיאה בהעברת הקצבה',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/share-transfers', async (req, res) => {
  try {
    const { productId } = req.query;
    const where = productId ? { productId: parseInt(productId) } : {};
    
    // Check if shareTransfer model exists
    if (!prisma.shareTransfer) {
      return res.status(500).json({ 
        error: 'ShareTransfer model not found. Please run: npx prisma generate' 
      });
    }
    
    const transfers = await prisma.shareTransfer.findMany({
      where,
      include: {
        product: true,
        fromMember: true,
        toMember: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(transfers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Share Request Routes
app.post('/api/share-requests', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { productId, fromMemberId, toMemberId, quantity } = req.body;
    
    // Get product
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
      include: { rules: true }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Get members
    const fromMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(fromMemberId) }
    });
    const toMember = await prisma.familyMember.findUnique({
      where: { id: parseInt(toMemberId) }
    });
    
    if (!fromMember || !toMember) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    if (fromMemberId === toMemberId) {
      return res.status(400).json({ error: 'Cannot request from yourself' });
    }
    
    // Check if toMember has available share
    const allMembers = await prisma.familyMember.findMany();
    const productRule = product.rules[0];
    let eligibleMembers = [];
    
    if (!productRule || productRule.ruleType === 'everyone') {
      eligibleMembers = allMembers;
    } else if (productRule.ruleType === 'children_only') {
      eligibleMembers = allMembers.filter(m => m.isChild);
    } else if (productRule.ruleType === 'adults_only') {
      eligibleMembers = allMembers.filter(m => !m.isChild);
    }
    
    if (eligibleMembers.length === 0) {
      return res.status(400).json({ error: 'No eligible members for this product' });
    }
    
    // Calculate original quantity
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: parseInt(productId) }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    
    const fairShare = Math.floor(originalQuantity / eligibleMembers.length);
    
    // Calculate how much toMember has already taken
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: parseInt(productId),
        memberId: parseInt(toMemberId)
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate how much toMember has already transferred
    const existingTransfers = await prisma.shareTransfer.findMany({
      where: {
        productId: parseInt(productId),
        fromMemberId: parseInt(toMemberId)
      }
    });
    
    const totalTransferred = existingTransfers.reduce((sum, t) => sum + t.quantity, 0);
    
    // Calculate remaining fair share for toMember
    const remainingFairShare = fairShare - totalTaken - totalTransferred;
    
    // Check if toMember has available share
    if (remainingFairShare <= 0) {
      return res.status(400).json({ 
        error: 'למשתמש נגמר המלאי במוצר' 
      });
    }
    
    // Check if trying to request more than remaining fair share
    if (parseInt(quantity) > remainingFairShare) {
      return res.status(400).json({ 
        error: `אין אפשרות לבקש יותר מההקצבה הזמינה. ההקצבה הזמינה: ${remainingFairShare}` 
      });
    }
    
    // Check if there's already a pending request
    let existingRequest = null;
    try {
      existingRequest = await prisma.shareRequest.findFirst({
        where: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId),
          toMemberId: parseInt(toMemberId),
          status: 'pending'
        }
      });
    } catch (requestError) {
      console.error('Error checking existing request:', requestError);
      // If shareRequest doesn't exist, continue (no existing request)
    }
    
    if (existingRequest) {
      return res.status(400).json({ error: 'יש לך כבר בקשה ממתינה למשתמש הזה' });
    }
    
    // Create request
    let request;
    try {
      request = await prisma.shareRequest.create({
        data: {
          productId: parseInt(productId),
          fromMemberId: parseInt(fromMemberId),
          toMemberId: parseInt(toMemberId),
          quantity: parseInt(quantity),
          status: 'pending'
        },
        include: {
          product: true,
          fromMember: true,
          toMember: true
        }
      });
    } catch (createError) {
      console.error('Error creating request:', createError);
      if (createError.message && createError.message.includes('shareRequest')) {
        return res.status(500).json({ 
          error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server',
          details: createError.message
        });
      }
      throw createError;
    }
    
    res.json(request);
  } catch (error) {
    console.error('Error in share request:', error);
    res.status(500).json({ error: error.message || 'שגיאה בבקשת הקצבה' });
  }
});

app.get('/api/share-requests', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.json([]); // Return empty array if model doesn't exist
    }
    
    const { memberId, status } = req.query;
    const where = {};
    
    if (memberId) {
      where.OR = [
        { fromMemberId: parseInt(memberId) },
        { toMemberId: parseInt(memberId) }
      ];
    }
    
    if (status) {
      where.status = status;
    }
    
    const requests = await prisma.shareRequest.findMany({
      where,
      include: {
        product: true,
        fromMember: true,
        toMember: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/share-requests/:id/approve', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { id } = req.params;
    
    // Get request
    const request = await prisma.shareRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        product: true,
        fromMember: true,
        toMember: true
      }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }
    
    // Check if toMember still has available share
    const allMembers = await prisma.familyMember.findMany();
    const product = await prisma.product.findUnique({
      where: { id: request.productId },
      include: { rules: true }
    });
    
    const productRule = product.rules[0];
    let eligibleMembers = [];
    
    if (!productRule || productRule.ruleType === 'everyone') {
      eligibleMembers = allMembers;
    } else if (productRule.ruleType === 'children_only') {
      eligibleMembers = allMembers.filter(m => m.isChild);
    } else if (productRule.ruleType === 'adults_only') {
      eligibleMembers = allMembers.filter(m => !m.isChild);
    }
    
    const allProductTransactions = await prisma.transaction.findMany({
      where: { productId: request.productId }
    });
    const totalTakenFromProduct = allProductTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const originalQuantity = product.quantity + totalTakenFromProduct;
    const fairShare = Math.floor(originalQuantity / eligibleMembers.length);
    
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        productId: request.productId,
        memberId: request.toMemberId
      }
    });
    
    const totalTaken = existingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    const existingTransfers = await prisma.shareTransfer.findMany({
      where: {
        productId: request.productId,
        fromMemberId: request.toMemberId
      }
    });
    
    const totalTransferred = existingTransfers.reduce((sum, t) => sum + t.quantity, 0);
    const remainingFairShare = fairShare - totalTaken - totalTransferred;
    
    if (remainingFairShare < request.quantity) {
      return res.status(400).json({ 
        error: 'למשתמש נגמר המלאי במוצר' 
      });
    }
    
    // Update request status
    const updatedRequest = await prisma.shareRequest.update({
      where: { id: parseInt(id) },
      data: { status: 'approved' },
      include: {
        product: true,
        fromMember: true,
        toMember: true
      }
    });
    
    // Create transfer
    await prisma.shareTransfer.create({
      data: {
        productId: request.productId,
        fromMemberId: request.toMemberId,
        toMemberId: request.fromMemberId,
        quantity: request.quantity
      }
    });
    
    res.json(updatedRequest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/share-requests/:id/reject', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { id } = req.params;
    
    const request = await prisma.shareRequest.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }
    
    const updatedRequest = await prisma.shareRequest.update({
      where: { id: parseInt(id) },
      data: { status: 'rejected' },
      include: {
        product: true,
        fromMember: true,
        toMember: true
      }
    });
    
    res.json(updatedRequest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/share-requests/:id', async (req, res) => {
  try {
    // Check if shareRequest model exists
    if (!prisma.shareRequest) {
      return res.status(500).json({ 
        error: 'ShareRequest model not found. Please run: npx prisma generate and restart the server' 
      });
    }
    
    const { id } = req.params;
    
    // Get request to check if it's pending
    const request = await prisma.shareRequest.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    // Only allow deletion of pending requests
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Can only cancel pending requests' });
    }
    
    await prisma.shareRequest.delete({
      where: { id: parseInt(id) }
    });
    
    res.json({ message: 'Request cancelled successfully' });
  } catch (error) {
    console.error('Error deleting request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete transaction (cancel taking product)
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get transaction
    const transaction = await prisma.transaction.findUnique({
      where: { id: parseInt(id) },
      include: {
        product: true
      }
    });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Delete transaction
    await prisma.transaction.delete({
      where: { id: parseInt(id) }
    });
    
    // Return quantity to product
    await prisma.product.update({
      where: { id: transaction.productId },
      data: {
        quantity: transaction.product.quantity + transaction.quantity
      }
    });
    
    res.json({ message: 'Transaction cancelled successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// Dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    const [members, products, transactions] = await Promise.all([
      prisma.familyMember.findMany(),
      prisma.product.findMany({
        include: { rules: true }
      }),
      prisma.transaction.findMany({
        include: {
          product: true,
          member: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ]);
    
    res.json({ members, products, transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
